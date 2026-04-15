import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubClient } from './github-client.js';
import { LLMClient } from './llm-client.js';
import { createDiagnosisIssue } from './output/create-issue.js';
import { createFixPR } from './output/create-pr.js';
import { appendToKnowledgeBase } from './output/knowledge-base.js';
import { commitSREArtifacts } from './output/commit-sre-artifacts.js';
import { dispatchRemediation } from './output/dispatch-remediation.js';

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

const INFRA_REMEDIATION_TYPES = ['infrastructure_action', 'escalation'];

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

  const isInfraIncident = !alert.blame_pr_number;
  if (isInfraIncident) {
    console.log(`🏗️  Infrastructure incident detected (no blame PR)`);
  }

  // 2. Fetch recent PRs, blame PR diff, and past incidents from knowledge base
  let recentPRs  = [];
  let blameDiff  = '';
  let currentFlywayVersion = 1;

  if (!isInfraIncident) {
    console.log('🔍 Fetching recent PRs from GitHub...');
    recentPRs  = await github.getRecentPRs(10);
    blameDiff  = await github.getPRDiff(alert.blame_pr_number);
    currentFlywayVersion = await github.getHighestFlywayVersion();
    console.log(`   ${recentPRs.length} PRs fetched. Blame PR: #${alert.blame_pr_number}`);
  } else {
    console.log('🔍 Infrastructure incident — skipping PR context fetch.');
  }

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
    blamePRTitle:  alert.blame_pr_title ?? '(no blame PR — infrastructure incident)',
    blamePRDiff:   blameDiff || '(no blame PR)',
    pastIncidents,
  });
  console.log(`   Confidence: ${diagnosisRaw.diagnosis.confidence}`);
  console.log(`   Root cause: ${diagnosisRaw.diagnosis.summary}`);

  // 4. Generate remediation with LLM ─────────────────────────────────────────
  // Confidence gate: low confidence → force pr_rollback (safest action) for app incidents,
  // or escalation for infrastructure incidents.
  // Medium confidence → allow targeted fix but the Issue will show a warning.
  const diagnosedType   = diagnosisRaw.remediation_type;
  const confidence      = diagnosisRaw.diagnosis?.confidence ?? 'low';
  let remediationType;

  if (confidence === 'low') {
    if (isInfraIncident || INFRA_REMEDIATION_TYPES.includes(diagnosedType)) {
      remediationType = 'escalation';
      if (diagnosedType !== 'escalation') {
        console.log(`⚠️  Confidence is LOW on infrastructure incident — overriding from '${diagnosedType}' → 'escalation'`);
      }
    } else {
      remediationType = 'pr_rollback';
      if (diagnosedType !== 'pr_rollback') {
        console.log(`⚠️  Confidence is LOW — overriding remediation from '${diagnosedType}' → 'pr_rollback' (safest action)`);
      }
    }
  } else {
    remediationType = diagnosedType;
    if (confidence === 'medium') {
      console.log(`⚠️  Confidence is MEDIUM — proceeding with '${remediationType}' but Issue will carry a warning`);
    }
  }

  console.log('🔧 Calling LLM for remediation plan...');
  const remediationRaw = await llm.remediate({
    diagnosisJson:          diagnosisRaw,
    remediationType,
    incidentId:             alert.incident_id,
    currentFlywayVersion,
  });

  if (remediationRaw.branch_name) {
    console.log(`   Fix PR branch: ${remediationRaw.branch_name}`);
  } else {
    console.log(`   Escalation-only — no fix branch.`);
  }

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

  const confidenceOverrideNote =
    confidence === 'low' && diagnosedType !== remediationType
      ? `Diagnosis confidence was LOW — remediation downgraded from \`${diagnosedType}\` to \`${remediationType}\` for safety. Human review of root cause is required before a targeted fix is attempted.`
      : null;

  console.log('📝 Creating post-incident GitHub Issue...');
  const issueUrl = await createDiagnosisIssue(github, {
    alert,
    diagnosis:              diagnosisRaw,
    remediation:            remediationRaw,
    targetIssueNumber:      TARGET_ISSUE_NUMBER ? parseInt(TARGET_ISSUE_NUMBER) : null,
    sreArtifacts,
    artifactPaths:          sreArtifacts ? artifactPaths : null,
    recentPRs,
    confidenceOverrideNote,
    isInfraIncident,
  });
  console.log(`   Issue: ${issueUrl}`);

  // 6. Create fix PR (skip for escalation — nothing to fix via code) ─────────
  let prUrl = null;
  if (remediationType !== 'escalation' && remediationRaw.branch_name) {
    console.log('🔀 Creating fix PR...');
    prUrl = await createFixPR(github, {
      remediation: remediationRaw,
      incidentId:  alert.incident_id,
      isInfraIncident,
    });
    console.log(`   PR: ${prUrl}`);
  } else {
    console.log('📨 Escalation-only incident — no fix PR created.');
  }

  // 6b. Dispatch infrastructure remediation workflow ──────────────────────────
  if (remediationType === 'infrastructure_action' && prUrl) {
    try {
      console.log('🚀 Dispatching infrastructure remediation workflow...');
      const dispatchResult = await dispatchRemediation(github, {
        incidentId:      alert.incident_id,
        infraActionType: remediationRaw.infra_action_type,
        targetResources: remediationRaw.target_resources,
        prUrl,
      });
      console.log(`   Workflow: ${dispatchResult.workflowUrl}`);
    } catch (err) {
      console.warn(`   Warning: could not dispatch remediation workflow: ${err.message}. The IaC PR was still created.`);
    }
  }

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
    if (prUrl) {
      fs.appendFileSync(outputFile, `fix_pr_url=${prUrl}\n`);
    }
    if (isInfraIncident) {
      fs.appendFileSync(outputFile, `incident_category=infrastructure\n`);
      fs.appendFileSync(outputFile, `remediation_type=${remediationType}\n`);
    }
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
