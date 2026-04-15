import fs from 'fs';
import { GitHubClient } from './github-client.js';
import { LLMClient } from './llm-client.js';

// ── Config from environment ──────────────────────────────────────────────────
const {
  GITHUB_REPO,
  FAILED_PR_NUMBER,
  FAILED_RUN_ID,
} = process.env;

if (!GITHUB_REPO || !FAILED_PR_NUMBER) {
  console.error('Missing required env: GITHUB_REPO, FAILED_PR_NUMBER');
  process.exit(1);
}

const [owner, repo] = GITHUB_REPO.split('/');

// ── Repair agent ─────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🔧 Repair Agent starting — failed PR #${FAILED_PR_NUMBER}\n`);

  const github = new GitHubClient(owner, repo);
  const llm    = new LLMClient();

  // 1. Fetch failed PR details ───────────────────────────────────────────────
  console.log('📂 Fetching failed PR details...');
  const pr = await github.getPRDetails(parseInt(FAILED_PR_NUMBER));
  console.log(`   PR #${pr.number}: "${pr.title}"`);
  console.log(`   Branch: ${pr.branch}`);
  console.log(`   Files: ${pr.fileContents.length}`);

  // 2. Check loop protection — don't repair a repair ────────────────────────
  if (pr.labels.includes('aiops-repair')) {
    console.log('   PR is already a repair attempt. Posting comment for human help.');
    await github.closePR(pr.number,
      '## Repair Failed\n\nThe auto-repaired fix also failed CI. This incident needs human intervention.\n\n> _SRE AIOps Agent — repair loop halted_'
    );
    console.log('   Closed with human-help comment.');
    return;
  }

  // 3. Fetch CI failure logs ─────────────────────────────────────────────────
  console.log('📋 Fetching CI failure logs...');
  const ciLogs = FAILED_RUN_ID
    ? await github.getWorkflowRunLogs(parseInt(FAILED_RUN_ID))
    : '(CI logs not available — run ID not provided)';
  console.log(`   Log size: ${ciLogs.length} chars`);

  // 4. Extract original diagnosis from PR body ───────────────────────────────
  //    The PR body contains the incident context — pass it as-is
  let originalDiagnosis = {};
  try {
    // Try to extract structured data from the PR body
    const bodyMatch = pr.body.match(/## Problem\n([\s\S]*?)(?=\n## |$)/);
    originalDiagnosis = {
      context: pr.body,
      problem_section: bodyMatch ? bodyMatch[1].trim() : pr.body,
      pr_title: pr.title,
    };
  } catch {
    originalDiagnosis = { context: pr.body, pr_title: pr.title };
  }

  // 5. Get current Flyway version ────────────────────────────────────────────
  const currentFlywayVersion = await github.getHighestFlywayVersion();

  // 6. Call LLM for repair ───────────────────────────────────────────────────
  console.log('🤖 Calling LLM to generate corrected fix...');
  const repairResult = await llm.repair({
    originalDiagnosis,
    originalFiles: pr.fileContents,
    ciLogs,
    currentFlywayVersion,
  });
  console.log(`   Analysis: ${repairResult.analysis.slice(0, 100)}...`);
  console.log(`   Repair branch: ${repairResult.branch_name}`);

  // 7. Create repair PR ─────────────────────────────────────────────────────
  console.log('🔀 Creating repair PR...');
  const { sha: baseSHA } = await github.getDefaultBranchSHA();

  const repairPrUrl = await github.createBranchWithFilesAndPR({
    branchName: repairResult.branch_name,
    baseSHA,
    files:      repairResult.files,
    prTitle:    repairResult.pr_title,
    prBody:     repairResult.pr_body,
  });
  console.log(`   Repair PR: ${repairPrUrl}`);

  // 8. Label the repair PR ───────────────────────────────────────────────────
  const repairPrNumber = parseInt(repairPrUrl.split('/').pop());
  await github.addLabels(repairPrNumber, ['aiops-repair', 'aiops-generated']);
  console.log('   Labels added: aiops-repair, aiops-generated');

  // 9. Close the original failed PR ─────────────────────────────────────────
  console.log('🗑️  Closing original failed PR...');
  await github.closePR(pr.number,
    `## Auto-Repair\n\nCI failed on this PR. The SRE AIOps Agent has analyzed the failure and created a corrected fix:\n\n**Repair PR:** ${repairPrUrl}\n\n**What changed:** ${repairResult.analysis}\n\n> _This PR has been closed. Please review the repair PR instead._`
  );
  console.log(`   PR #${pr.number} closed.`);

  // 10. Emit GitHub Actions outputs ──────────────────────────────────────────
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `repair_pr_url=${repairPrUrl}\n`);
    fs.appendFileSync(outputFile, `original_pr_number=${pr.number}\n`);
  }

  console.log('\n✅ Repair Agent completed successfully.\n');
}

run().catch((err) => {
  console.error('\n❌ Repair Agent failed:', err.message || err);
  if (err.stack) console.error(err.stack);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `\n## Repair Agent Failure\n\n**Error:** ${err.message}\n\n**Failed PR:** #${FAILED_PR_NUMBER}\n`);
  }

  process.exit(1);
});
