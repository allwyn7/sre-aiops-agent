import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class LLMClient {
  constructor() {
    this.client = new Anthropic();
    this.model  = 'claude-opus-4-6';
  }

  // Build a prompt from a template file, substituting {{PLACEHOLDERS}}
  _renderTemplate(templateName, vars) {
    let template = fs.readFileSync(
      path.join(__dirname, 'prompts', templateName),
      'utf8'
    );
    for (const [key, value] of Object.entries(vars)) {
      template = template.replaceAll(`{{${key}}}`, String(value ?? ''));
    }
    return template;
  }

  // Parse JSON from LLM response, handling occasional markdown fences
  _parseJSON(text) {
    // Try direct parse first
    try {
      return JSON.parse(text.trim());
    } catch { /* fall through to fence stripping */ }

    // Strip markdown fences
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch { /* fall through to regex extraction */ }

    // Last resort: extract first JSON object from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }

    throw new Error(`Failed to parse LLM response as JSON. Response starts with: ${text.slice(0, 200)}`);
  }

  // Retry wrapper for LLM API calls
  async _callWithRetry(fn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isRetryable = err.status === 429 || err.status === 500 || err.status === 529 || err.message?.includes('overloaded');
        if (attempt === maxRetries || !isRetryable) throw err;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`   LLM call failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async diagnose({ alert, logs, recentPRs, blamePRNumber, blamePRTitle, blamePRDiff, pastIncidents }) {
    const prList = recentPRs
      .map(pr => `- PR #${pr.number} by @${pr.author} (merged ${pr.merged_at}): "${pr.title}"`)
      .join('\n');

    const prompt = this._renderTemplate('diagnose.txt', {
      ALERT_JSON:       JSON.stringify(alert, null, 2),
      LOGS:             logs,
      RECENT_PRS:       prList,
      BLAME_PR_NUMBER:  blamePRNumber,
      BLAME_PR_TITLE:   blamePRTitle,
      BLAME_PR_DIFF:    blamePRDiff,
      PAST_INCIDENTS:   pastIncidents || '_No prior incidents recorded._',
    });

    const message = await this._callWithRetry(() =>
      this.client.messages.create({
        model:      this.model,
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      })
    );

    return this._parseJSON(message.content[0].text);
  }

  async remediate({ diagnosisJson, remediationType, incidentId, currentFlywayVersion }) {
    const prompt = this._renderTemplate('remediate.txt', {
      DIAGNOSIS_JSON:          JSON.stringify(diagnosisJson, null, 2),
      REMEDIATION_TYPE:        remediationType,
      INCIDENT_ID:             incidentId,
      INCIDENT_ID_LOWER:       incidentId.toLowerCase().replace(/_/g, '-'),
      CURRENT_FLYWAY_VERSION:  currentFlywayVersion,
    });

    const message = await this._callWithRetry(() =>
      this.client.messages.create({
        model:      this.model,
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      })
    );

    return this._parseJSON(message.content[0].text);
  }

  async generateSREArtifacts({ alert, logs, diagnosisJson, remediationJson }) {
    const prompt = this._renderTemplate('sre-artifacts.txt', {
      ALERT_JSON:       JSON.stringify(alert, null, 2),
      LOGS:             logs,
      DIAGNOSIS_JSON:   JSON.stringify(diagnosisJson, null, 2),
      REMEDIATION_JSON: JSON.stringify(remediationJson, null, 2),
    });

    const message = await this._callWithRetry(() =>
      this.client.messages.create({
        model:      this.model,
        max_tokens: 8192,
        messages:   [{ role: 'user', content: prompt }],
      })
    );

    return this._parseJSON(message.content[0].text);
  }

  async repair({ originalDiagnosis, originalFiles, ciLogs, currentFlywayVersion }) {
    const filesFormatted = originalFiles
      .map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');

    const prompt = this._renderTemplate('repair.txt', {
      ORIGINAL_DIAGNOSIS:   JSON.stringify(originalDiagnosis, null, 2),
      ORIGINAL_FILES:       filesFormatted,
      CI_LOGS:              ciLogs,
      CURRENT_FLYWAY_VERSION: currentFlywayVersion,
    });

    const message = await this._callWithRetry(() =>
      this.client.messages.create({
        model:      this.model,
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      })
    );

    return this._parseJSON(message.content[0].text);
  }
}
