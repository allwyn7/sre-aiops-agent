# SRE AIOps Agent — GitHub Copilot Instructions

This repository contains an AI-powered SRE incident response agent that runs entirely on the GitHub platform.

## What this repo does

When a production incident fires, this agent:
1. Ingests alert payload + application logs
2. Reads the knowledge base of past incidents
3. Calls **GitHub Models (gpt-4o)** to diagnose the root cause and identify the blame PR
4. Generates a targeted fix (SQL migration, code patch, config change, feature flag toggle, or rollback)
5. Opens a **Fix PR** with CI validation
6. Creates a **Post-Incident GitHub Issue** with Mermaid timeline, severity score, escalation path
7. Commits runbook + Prometheus alerting rules + recommendations to the knowledge base
8. If CI fails on the fix PR, a repair agent reads the error logs and opens a corrected PR

## Architecture

- **LLM**: GitHub Models API (`models.inference.ai.azure.com`) — gpt-4o, same infrastructure as GitHub Copilot
- **GitHub API**: Octokit REST — creates branches, commits, PRs, Issues
- **MCP**: Official `github/github-mcp-server` binary — 26 tools, configured against `github.tools.sap`
- **Runner**: GitHub Actions (`incident-response.yml`) or local Node.js (`node agent/index.js`)
- **Trigger**: `workflow_dispatch` (manual), `repository_dispatch` (webhook from Azure Monitor or SAP Alert Notification)

## Key files

- `agent/index.js` — main 8-step pipeline orchestrator
- `agent/llm-client.js` — GitHub Models API calls (diagnose, remediate, sre-artifacts)
- `agent/github-client.js` — all GitHub API operations
- `agent/output/create-issue.js` — post-incident Issue with evidence trail + confidence warning
- `agent/output/create-pr.js` — fix PR creation
- `agent/output/commit-sre-artifacts.js` — runbook + alerting rules + recommendations
- `agent/prompts/diagnose.txt` — LLM diagnosis prompt
- `agent/prompts/remediate.txt` — LLM remediation prompt
- `incidents/` — 5 SAP-realistic incident scenarios (alert.json + logs.txt per scenario)
- `knowledge-base/incidents.md` — accumulated past incident patterns (learning loop)
- `.github/workflows/incident-response.yml` — main GitHub Actions workflow

## Incident scenarios

| Scenario | Service | Severity | Root Cause | Fix Type |
|----------|---------|----------|------------|----------|
| `scenario-1-oom-cache` | Spring Boot | P1 | HashMap cache, no eviction, heap 98.7% | `code_fix` |
| `scenario-2-500-schema-drift` | Spring Boot | P1 | JPA field removed, Flyway migration missing | `flyway_migration` |
| `scenario-3-n-plus-one-timeout` | Spring Boot | P2 | LAZY→EAGER fetch, 1,205 SQL/request | `code_fix` |
| `scenario-4-xsuaa-auth` | BTP / CF | P1 | xsappname changed, bindings not re-created | `config_fix` |
| `scenario-5-cap-deep-expand` | SAP CAP | P2 | `deep_reads: true`, 340 HANA queries/request | `feature_flag` |

## Remediation types

- `flyway_migration` — SQL migration file to fix schema drift
- `code_fix` — Java/Node source patch (cache eviction, fetch strategy fix)
- `config_fix` — YAML/JSON config correction (XSUAA binding, env vars)
- `feature_flag` — toggle a feature off without a deployment
- `pr_rollback` — revert the blame PR (used for P0/P1 or low-confidence diagnosis)
- `dependency_update` — update a broken/vulnerable dependency

## Confidence gate

If diagnosis confidence is **low**, the agent **automatically overrides** the remediation type to `pr_rollback` — the safest action. A `[!WARNING]` block appears at the top of the GitHub Issue showing the SRE exactly what evidence was analyzed and why confidence is uncertain.

## How to trigger a run

**GitHub Actions (UI):**
Go to Actions → Incident Response Agent → Run workflow → pick a scenario

**Local:**
```bash
export GITHUB_TOKEN=<your-pat>
export GH_MODELS_TOKEN=<github.com-pat-with-models-permission>
export GITHUB_REPO=allwyn7/sre-aiops-agent
export INCIDENT_SCENARIO=scenario-2-500-schema-drift
node agent/index.js
```

**Azure Monitor webhook:**
POST to `https://api.github.com/repos/{owner}/{repo}/dispatches` with `event_type: azure-monitor-alert` and the Azure Monitor Common Schema payload as `client_payload.azure_alert`.

## Knowledge base

The `knowledge-base/` folder is the agent's memory:
- `incidents.md` — past incident patterns, read before every diagnosis
- `runbooks/` — operational runbooks per incident
- `alerting-rules/` — Prometheus YAML alerting rules per incident
- `recommendations/` — capacity, DR, and performance recommendations

When answering questions about past incidents, runbooks, or alerting rules, read these files directly.
