import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubClient } from './github-client.js';
import { LLMClient } from './llm-client.js';
import { ToolExecutor } from './tool-executor.js';
import { TOOLS } from './tools.js';

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
  console.log(`\nSRE AIOps Agent starting — scenario: ${INCIDENT_SCENARIO}\n`);

  const github      = new GitHubClient(owner, repo);
  const llm         = new LLMClient();
  const scenarioDir = path.join(__dirname, '..', 'incidents', INCIDENT_SCENARIO);

  const toolExecutor = new ToolExecutor(
    github,
    scenarioDir,
    TARGET_ISSUE_NUMBER ? parseInt(TARGET_ISSUE_NUMBER) : null
  );

  // Load system prompt
  const systemPrompt = fs.readFileSync(
    path.join(__dirname, 'prompts', 'system.txt'),
    'utf8'
  );

  // Minimal user message — the agent calls tools to fetch all incident details
  const userMessage = [
    `New production incident to investigate and resolve.`,
    ``,
    `Scenario: ${INCIDENT_SCENARIO}`,
    `Repository: ${GITHUB_REPO}`,
    `Run ID: ${RUN_ID || 'local'}`,
    `Target issue number for comment: ${TARGET_ISSUE_NUMBER || 'none — create a new issue'}`,
    ``,
    `Start by calling get_incident_alert and get_incident_logs.`,
  ].join('\n');

  // Run the agent — gpt-4o drives its own tool-calling loop
  const { finalMessage, messages } = await llm.runAgent({
    systemPrompt,
    userMessage,
    tools:         TOOLS,
    toolExecutor,
    maxIterations: 25,
  });

  // Extract GitHub URLs from the tool result messages
  const issueUrl = extractToolResult(messages, 'create_github_issue', 'issue_url');
  const prUrl    = extractToolResult(messages, 'create_fix_pr',       'pr_url');

  // Emit GitHub Actions outputs
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    if (issueUrl) fs.appendFileSync(outputFile, `diagnosis_issue_url=${issueUrl}\n`);
    if (prUrl)    fs.appendFileSync(outputFile, `fix_pr_url=${prUrl}\n`);

    // Artifact paths from commit_sre_artifact tool results
    const runbookPath       = extractToolResult(messages, 'commit_sre_artifact', 'runbook_path');
    const alertingRulesPath = extractToolResult(messages, 'commit_sre_artifact', 'alerting_rules_path');
    const recommendationsPath = extractToolResult(messages, 'commit_sre_artifact', 'recommendations_path');
    if (runbookPath)         fs.appendFileSync(outputFile, `runbook_path=${runbookPath}\n`);
    if (alertingRulesPath)   fs.appendFileSync(outputFile, `alerting_rules_path=${alertingRulesPath}\n`);
    if (recommendationsPath) fs.appendFileSync(outputFile, `recommendations_path=${recommendationsPath}\n`);
  }

  console.log('\nAgent completed.\n');
  if (finalMessage) console.log(finalMessage);
}

// Scan message history for a tool result produced by a specific tool call.
// Finds the assistant message with a matching tool_call function name, then
// locates the tool role message with the same tool_call_id.
function extractToolResult(messages, toolName, field) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.tool_calls) continue;
    for (const tc of msg.tool_calls) {
      if (tc.function.name !== toolName) continue;
      const resultMsg = messages.find(
        m => m.role === 'tool' && m.tool_call_id === tc.id
      );
      if (resultMsg) {
        try {
          const parsed = JSON.parse(resultMsg.content);
          if (parsed[field] !== undefined) return parsed[field];
        } catch { /* skip unparseable results */ }
      }
    }
  }
  return null;
}

run().catch((err) => {
  console.error('\nAgent failed:', err.message || err);
  if (err.stack) console.error(err.stack);

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile,
      `\n## Agent Failure\n\n**Error:** ${err.message}\n\n**Scenario:** ${INCIDENT_SCENARIO}\n`
    );
  }

  process.exit(1);
});
