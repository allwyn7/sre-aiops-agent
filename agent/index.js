import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubClient } from './github-client.js';
import { LLMClient } from './llm-client.js';
import { ToolExecutor } from './tool-executor.js';
import { TOOLS } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Core agent logic (exported for Copilot Extension server) ─────────────────
/**
 * Run the SRE AIOps agent for a given scenario.
 * @param {object} opts
 * @param {string} opts.scenario        - e.g. "scenario-2-500-schema-drift"
 * @param {string} opts.repo            - "owner/repo"
 * @param {string} opts.token           - GitHub PAT for API calls
 * @param {string} [opts.modelsToken]   - GitHub PAT for GitHub Models (falls back to token)
 * @param {string} [opts.targetIssueNumber]
 * @param {string} [opts.runId]
 * @param {function} [opts.onProgress]  - called with progress strings for streaming
 * @returns {{ issueUrl, prUrl, finalMessage }}
 */
export async function runScenario({
  scenario,
  repo,
  token,
  modelsToken,
  targetIssueNumber,
  runId = 'local',
  onProgress = () => {},
}) {
  const log = (msg) => { console.log(msg); onProgress(msg); };

  log(`\nSRE AIOps Agent starting — scenario: ${scenario}\n`);

  const [owner, repoName] = repo.split('/');
  const github      = new GitHubClient(owner, repoName, token);
  const llm         = new LLMClient(modelsToken || token);
  const scenarioDir = path.join(__dirname, '..', 'incidents', scenario);

  const toolExecutor = new ToolExecutor(
    github,
    scenarioDir,
    targetIssueNumber ? parseInt(targetIssueNumber) : null
  );

  const systemPrompt = fs.readFileSync(
    path.join(__dirname, 'prompts', 'system.txt'),
    'utf8'
  );

  const userMessage = [
    `New production incident to investigate and resolve.`,
    ``,
    `Scenario: ${scenario}`,
    `Repository: ${repo}`,
    `Run ID: ${runId}`,
    `Target issue number for comment: ${targetIssueNumber || 'none — create a new issue'}`,
    ``,
    `Start by calling get_incident_alert and get_incident_logs.`,
  ].join('\n');

  const { finalMessage, messages } = await llm.runAgent({
    systemPrompt,
    userMessage,
    tools:         TOOLS,
    toolExecutor,
    maxIterations: 25,
    onProgress:    log,
  });

  const issueUrl = extractToolResult(messages, 'create_github_issue', 'issue_url');
  const prUrl    = extractToolResult(messages, 'create_fix_pr',       'pr_url');

  log('\nAgent completed.\n');
  if (finalMessage) log(finalMessage);

  return { issueUrl, prUrl, finalMessage };
}

// ── CLI entry point ──────────────────────────────────────────────────────────
async function run() {
  const {
    GITHUB_REPO,
    INCIDENT_SCENARIO,
    TARGET_ISSUE_NUMBER,
    RUN_ID,
    GITHUB_TOKEN,
    GITHUB_MODELS_TOKEN,
  } = process.env;

  if (!GITHUB_REPO || !INCIDENT_SCENARIO) {
    console.error('Missing required env: GITHUB_REPO, INCIDENT_SCENARIO');
    process.exit(1);
  }

  const { issueUrl, prUrl } = await runScenario({
    scenario:          INCIDENT_SCENARIO,
    repo:              GITHUB_REPO,
    token:             GITHUB_TOKEN,
    modelsToken:       GITHUB_MODELS_TOKEN,
    targetIssueNumber: TARGET_ISSUE_NUMBER,
    runId:             RUN_ID,
  });

  // Emit GitHub Actions outputs
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    if (issueUrl) fs.appendFileSync(outputFile, `diagnosis_issue_url=${issueUrl}\n`);
    if (prUrl)    fs.appendFileSync(outputFile, `fix_pr_url=${prUrl}\n`);
  }
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

// Only invoke the CLI when this file is run directly (not imported as a module)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error('\nAgent failed:', err.message || err);
    if (err.stack) console.error(err.stack);

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      fs.appendFileSync(summaryFile,
        `\n## Agent Failure\n\n**Error:** ${err.message}\n\n**Scenario:** ${process.env.INCIDENT_SCENARIO}\n`
      );
    }

    process.exit(1);
  });
}
