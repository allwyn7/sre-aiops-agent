import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubClient } from './github-client.js';
import { LLMClient } from './llm-client.js';
import { createDiagnosisIssue } from './output/create-issue.js';
import { createFixPR } from './output/create-pr.js';
import { appendToKnowledgeBase } from './output/knowledge-base.js';
import { commitSREArtifacts } from './output/commit-sre-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config from environment ──────────────────────────────────────────────────
const {
  GITHUB_REPO,
  INCIDENT_SCENARIO,
  TARGET_ISSUE_NUMBER,
  RUN_ID,
} = process.env;

if (!GITHUB_REPO || !INCIDENT_SCENARIO) {
  console.error('Missing required env: GITHUB_REPO, INCIDENT_SCENARIO');
  process.exit(1);
}

const [owner, repo] = GITHUB_REPO.split('/');

// ── Main agent loop ──────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🚨 AIOps Agent starting — scenario: ${INCIDENT_SCENARIO}\n`);

  const github = new GitHubClient(owner, repo);
  const llm    = new LLMClient();

  // 1. Load incident payload ─────────────────────────────────────────────────
  const scenarioDir = path.join(__dirname, '..', 'incidents', INCIDENT_SCENARIO);
  const alert = JSON.parse(
    fs.readFileSync(path.join(scenarioDir, 'alert.json'), 'utf8')
  );
  const logs = fs.readFileSync(path.join(scenarioDir, 'logs.txt'), 'utf8');
  console.log(`📂 Loaded incident: ${alert.incident_id} — ${alert.title}`);

  // 2. Fetch recent PRs, blame PR diff, and past incidents from knowledge base
  console.log('🔍 Fetching recent PRs from GitHub...');
  const recentPRs  = await github.getRecentPRs(10);
  const blameDiff  = await github.getPRDiff(alert.blame_pr_number);
  const currentFlywayVersion = await github.getHighestFlywayVersion();
  console.log(`   ${recentPRs.length} PRs fetched. Blame PR: #${alert.blame_pr_number}`);

  // 2b. Load past incidents from knowledge base for learning loop
  console.log('📚 Loading past incidents from knowledge base...');
  const kbData = await github.getFileContent('knowledge-base/incidents.md');
  const pastIncidents = kbData?.content ?? '';
  const pastIncidentCount = (pastIncidents.match(/^## INC-/gm) || []).length;
  console.log(`   ${pastIncidentCount} past incident(s) loaded for context.`);

  // 3. Diagnose with LLM ─────────────────────────────────────────────────────
  console.log('🤖 Calling LLM for diagnosis...');
  const diagnosisRaw = await llm.diagnose({
    alert,
    logs,
    recentPRs,
    blamePRNumber: alert.blame_pr_number,
    blamePRTitle:  alert.blame_pr_title,
    blamePRDiff:   blameDiff,
    pastIncidents,
  });
  console.log(`   Confidence: ${diagnosisRaw.diagnosis.confidence}`);
  console.log(`   Root cause: ${diagnosisRaw.diagnosis.summary}`);

  // 4. Generate remediation with LLM ─────────────────────────────────────────
  console.log('🔧 Calling LLM for remediation plan...');
  const remediationRaw = await llm.remediate({
    diagnosisJson:          diagnosisRaw,
    remediationType:        diagnosisRaw.remediation_type,
    incidentId:             alert.incident_id,
    currentFlywayVersion,
  });
  console.log(`   Fix PR branch: ${remediationRaw.branch_name}`);

  // 4b. Generate SRE artifacts with LLM ──────────────────────────────────────
  let sreArtifacts = null;
  try {
    console.log('📋 Calling LLM for SRE artifacts (runbook, alerting rules, capacity planning, DR, performance tuning)...');
    sreArtifacts = await llm.generateSREArtifacts({
      alert,
      logs,
      diagnosisJson:    diagnosisRaw,
      remediationJson:  remediationRaw,
    });
    console.log(`   Severity: ${sreArtifacts.incident_response_metadata?.severity_score}/10`);
    console.log(`   MTTR estimate: ${sreArtifacts.incident_response_metadata?.mttr_estimate_minutes} min`);
  } catch (err) {
    console.warn(`   Warning: SRE artifact generation failed: ${err.message}. Continuing without artifacts.`);
  }

  // 5. Post diagnosis issue (enhanced with SRE metadata) ─────────────────────
  const idLower = alert.incident_id.toLowerCase().replace(/_/g, '-');
  const artifactPaths = {
    runbookPath:          `knowledge-base/runbooks/${idLower}.md`,
    alertingRulesPath:    `knowledge-base/alerting-rules/${idLower}.yml`,
    recommendationsPath:  `knowledge-base/recommendations/${idLower}.md`,
  };

  console.log('📝 Creating post-incident GitHub Issue...');
  const issueUrl = await createDiagnosisIssue(github, {
    alert,
    diagnosis:         diagnosisRaw,
    remediation:       remediationRaw,
    targetIssueNumber: TARGET_ISSUE_NUMBER ? parseInt(TARGET_ISSUE_NUMBER) : null,
    sreArtifacts,
    artifactPaths:     sreArtifacts ? artifactPaths : null,
  });
  console.log(`   Issue: ${issueUrl}`);

  // 6. Create fix PR ─────────────────────────────────────────────────────────
  console.log('🔀 Creating fix PR...');
  const prUrl = await createFixPR(github, {
    remediation: remediationRaw,
    incidentId:  alert.incident_id,
  });
  console.log(`   PR: ${prUrl}`);

  // 7. Append to knowledge base ──────────────────────────────────────────────
  console.log('📚 Updating knowledge base...');
  await appendToKnowledgeBase(github, { alert, diagnosis: diagnosisRaw, prUrl, issueUrl });

  // 7b. Commit SRE artifacts to knowledge base ───────────────────────────────
  if (sreArtifacts) {
    console.log('📋 Committing SRE artifacts to knowledge base...');
    const artifactResult = await commitSREArtifacts(github, {
      alert,
      sreArtifacts,
      issueUrl,
      prUrl,
    });
    console.log(`   Runbook: ${artifactResult.runbookPath}`);
    console.log(`   Alerting rules: ${artifactResult.alertingRulesPath}`);
    console.log(`   Recommendations: ${artifactResult.recommendationsPath}`);
  }

  // 8. Emit GitHub Actions outputs ───────────────────────────────────────────
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `diagnosis_issue_url=${issueUrl}\n`);
    fs.appendFileSync(outputFile, `fix_pr_url=${prUrl}\n`);
    if (sreArtifacts) {
      fs.appendFileSync(outputFile, `runbook_path=${artifactPaths.runbookPath}\n`);
      fs.appendFileSync(outputFile, `alerting_rules_path=${artifactPaths.alertingRulesPath}\n`);
      fs.appendFileSync(outputFile, `recommendations_path=${artifactPaths.recommendationsPath}\n`);
    }
  }

  console.log('\n✅ Agent completed successfully.\n');
}

run().catch((err) => {
  console.error('\n❌ Agent failed:', err.message || err);
  if (err.stack) console.error(err.stack);

  // Write failure summary to GitHub Actions
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `\n## Agent Failure\n\n**Error:** ${err.message}\n\n**Scenario:** ${process.env.INCIDENT_SCENARIO}\n`);
  }

  process.exit(1);
});
