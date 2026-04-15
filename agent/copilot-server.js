/**
 * copilot-server.js
 *
 * GitHub Copilot Extension server for the SRE AIOps Agent.
 * Exposes a POST / endpoint that GitHub Copilot Chat calls when a user
 * types `@sre-agent <message>` in any Copilot Chat surface.
 *
 * Protocol: GitHub sends the conversation as JSON; we stream back
 * Server-Sent Events (SSE) in the OpenAI chat-streaming format.
 *
 * Setup:
 *   1. Deploy this server publicly (Cloud Foundry, Railway, Render, etc.)
 *   2. Register a GitHub App at github.com/settings/apps/new
 *      - Enable "Copilot Extension" with your server URL as the callback
 *      - Copy the webhook secret → set COPILOT_WEBHOOK_SECRET env var
 *   3. Set GITHUB_TOKEN and GITHUB_REPO env vars on the server
 *   4. Install the GitHub App on your org/repo
 *   5. Type `@sre-agent run scenario-2` in GitHub Copilot Chat
 *
 * Environment variables:
 *   GITHUB_TOKEN          — PAT for GitHub API + GitHub Models
 *   GITHUB_MODELS_TOKEN   — (optional) separate PAT for GitHub Models
 *   GITHUB_REPO           — default owner/repo (can be overridden per message)
 *   COPILOT_WEBHOOK_SECRET — GitHub App webhook secret for request verification
 *   PORT                  — HTTP port (default 3000)
 */

import express from 'express';
import crypto  from 'crypto';
import { runScenario } from './index.js';

const app = express();
app.use(express.json());

// ── Scenario name resolution ─────────────────────────────────────────────────

const SCENARIOS = {
  '1': 'scenario-1-oom-cache',
  '2': 'scenario-2-500-schema-drift',
  '3': 'scenario-3-n-plus-one-timeout',
  '4': 'scenario-4-xsuaa-auth',
  '5': 'scenario-5-cap-deep-expand',
};

const SCENARIO_DESCRIPTIONS = {
  '1': 'OOM heap exhaustion (unbounded cache)',
  '2': 'HTTP 500 schema drift (missing Flyway migration)',
  '3': 'Request timeouts (N+1 query / connection pool)',
  '4': 'HTTP 401/403 XSUAA auth failure (stale binding)',
  '5': 'OData timeouts (CAP deep expand / HANA pool)',
};

/**
 * Extract a scenario identifier from the user's free-text message.
 * Handles: "run scenario-2", "scenario 2", "2", "scenario-2-500-schema-drift"
 */
function extractScenario(text) {
  // Full slug match: scenario-N-something
  const slugMatch = text.match(/\bscenario-(\d+)-[\w-]+/i);
  if (slugMatch) return SCENARIOS[slugMatch[1]] || slugMatch[0];

  // "scenario N" or "scenario-N"
  const nameMatch = text.match(/\bscenario[-\s](\d+)\b/i);
  if (nameMatch) return SCENARIOS[nameMatch[1]] || null;

  // Bare digit at end of message: "@sre-agent 2"
  const digitMatch = text.match(/\b([1-5])\b/);
  if (digitMatch) return SCENARIOS[digitMatch[1]] || null;

  return null;
}

// ── Request signature verification ──────────────────────────────────────────

/**
 * Verify the GitHub Copilot Extension request signature.
 * GitHub signs each request with HMAC-SHA256 using the App's webhook secret.
 * Only enforced when COPILOT_WEBHOOK_SECRET is set.
 */
function verifySignature(req) {
  const secret = process.env.COPILOT_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification in local dev

  const sig = req.headers['x-github-public-key-signature'] ||
              req.headers['github-public-key-signature'];
  if (!sig) return false;

  const body    = JSON.stringify(req.body);
  const hmac    = crypto.createHmac('sha256', secret);
  const digest  = 'sha256=' + hmac.update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sseText(res, text) {
  const payload = JSON.stringify({
    choices: [{ delta: { content: text }, finish_reason: null, index: 0 }],
  });
  res.write(`data: ${payload}\n\n`);
}

function sseDone(res) {
  res.write('data: [DONE]\n\n');
}

// ── Copilot Extension endpoint ───────────────────────────────────────────────

app.post('/', async (req, res) => {
  // Verify request authenticity
  if (!verifySignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Open SSE stream immediately so Copilot Chat shows the typing indicator
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Parse the last user message from the conversation
  const messages      = req.body.messages || [];
  const lastUserMsg   = [...messages].reverse().find(m => m.role === 'user');
  const userText      = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : lastUserMsg?.content?.map(c => c.text ?? '').join(' ') ?? '';

  const scenario = extractScenario(userText);

  // No scenario found — show help
  if (!scenario) {
    const help = [
      'I can run any of these incident scenarios:\n',
      ...Object.entries(SCENARIOS).map(
        ([n, slug]) => `- \`${n}\` — **${slug}**\n  ${SCENARIO_DESCRIPTIONS[n]}`
      ),
      '\n**Usage:** `@sre-agent run scenario-2` or just `@sre-agent 2`',
    ].join('\n');
    sseText(res, help);
    sseDone(res);
    res.end();
    return;
  }

  const token     = process.env.GITHUB_TOKEN;
  const repo      = process.env.GITHUB_REPO;

  if (!token || !repo) {
    sseText(res, 'Server misconfiguration: `GITHUB_TOKEN` and `GITHUB_REPO` must be set.');
    sseDone(res);
    res.end();
    return;
  }

  sseText(res, `Running **${scenario}**...\n\n`);

  try {
    const { issueUrl, prUrl, finalMessage } = await runScenario({
      scenario,
      repo,
      token,
      modelsToken: process.env.GITHUB_MODELS_TOKEN,
      onProgress:  (msg) => sseText(res, msg),
    });

    const lines = ['\n\n---\n**Agent completed.**\n'];
    if (issueUrl) lines.push(`- **Diagnosis issue:** ${issueUrl}`);
    if (prUrl)    lines.push(`- **Fix PR:** ${prUrl}`);
    if (finalMessage) lines.push(`\n${finalMessage}`);
    sseText(res, lines.join('\n'));
  } catch (err) {
    sseText(res, `\n\n**Agent failed:** ${err.message}`);
  }

  sseDone(res);
  res.end();
});

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ────────────────────────────────────────────────────────────────────

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SRE AIOps Copilot Extension listening on :${port}`);
  console.log(`  GITHUB_REPO: ${process.env.GITHUB_REPO || '(not set)'}`);
  console.log(`  Signature verification: ${process.env.COPILOT_WEBHOOK_SECRET ? 'enabled' : 'disabled (dev mode)'}`);
});
