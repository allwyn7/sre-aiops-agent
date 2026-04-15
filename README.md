# SRE AIOps Agent

A GitHub Copilot-backed incident response agent that automatically diagnoses production incidents, correlates them to recent code changes, generates remediation PRs, produces operational runbooks, and learns from every incident — all within GitHub, with zero external dependencies.

> **"You build it, you run it"** — This agent bridges the gap between operational signals (error logs, metrics spikes, deployment events) and development artifacts (code changes, PRs, configuration diffs).

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                   Incident Trigger                               │
│          (GitHub Actions workflow_dispatch or local CLI)         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │      Agent (Node.js)       │
              │                           │
              │  1. Load alert + logs      │
              │  2. Fetch recent PRs       │
              │  3. Read knowledge base    │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    GitHub Models (gpt-4o)  │
              │  models.inference.ai.azure │
              │                           │
              │  • Diagnose root cause     │
              │  • Generate fix files      │
              │  • Generate SRE artifacts  │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │       GitHub API           │
              │                           │
              │  • Create Issue (report)   │
              │  • Open fix PR             │
              │  • Commit runbooks/rules   │
              │  • Update knowledge base   │
              └───────────────────────────┘
```

### Pipeline Steps

1. **Ingest** — Load `alert.json` + `logs.txt` + recent merged PRs + blame PR diff from GitHub
2. **Learn** — Read `knowledge-base/incidents.md` to identify recurring patterns from past incidents
3. **Diagnose** — LLM correlates logs, PR diffs, and past incidents; outputs structured root cause JSON
4. **Remediate** — LLM generates fix files (Flyway migration, code patch, config fix, feature flag toggle, or rollback)
5. **SRE Artifacts** — LLM generates runbook, Prometheus alerting rules, capacity/DR/performance recommendations
6. **Report** — Creates a post-incident GitHub Issue with Mermaid timeline, severity, MTTR estimate, escalation path, and artifact links
7. **Fix PR** — Opens a PR with generated fix files; CI validates automatically
8. **Learn** — Appends incident entry to knowledge base; commits runbook, alerting rules, and recommendations

---

## Incident Scenarios

| Scenario | Incident | Severity | Remediation Type | Root Cause |
|----------|----------|----------|-----------------|------------|
| `scenario-1-oom-cache` | OutOfMemoryError — heap exhausted | P1 | `code_fix` | PR #48 added unbounded static HashMap cache with no eviction |
| `scenario-2-500-schema-drift` | HTTP 500 — Hibernate SQLGrammarException | P1 | `flyway_migration` | PR #52 removed JPA field but no Flyway migration dropped the DB column |
| `scenario-3-n-plus-one-timeout` | Request timeouts — connection pool exhausted | P2 | `code_fix` | PR #55 changed fetch type to EAGER, causing 1,205 SQL queries per request |
| `scenario-4-xsuaa-auth` | HTTP 401/403 — XSUAA token validation failure | P1 | `config_fix` | PR #58 updated `xsappname` without re-creating service bindings |
| `scenario-5-cap-deep-expand` | OData timeouts — HANA pool exhausted | P2 | `feature_flag` | PR #62 enabled `deep_reads` in CAP `package.json`, generating 300+ HANA queries per request |

---

## Key Features

### 6 Remediation Types

The agent selects the appropriate fix strategy based on the diagnosis:

| Type | When Used | Example |
|------|-----------|---------|
| `flyway_migration` | DB schema drifted from JPA entity | Add `DROP COLUMN` migration |
| `code_fix` | Bug introduced in application code | Fix N+1 query, add cache eviction |
| `config_fix` | Misconfigured service binding or app config | Correct `xsappname`, update bindings |
| `feature_flag` | New feature flag causing blast radius | Set `cds.features.deep_reads: false` |
| `pr_rollback` | P0/P1 where reverting is fastest mitigation | Generate files in pre-PR state |
| `dependency_update` | Vulnerable or broken dependency version | Bump version in `pom.xml` / `package.json` |

### 6 SRE Artifacts Per Incident

Every run generates:

| Artifact | Location |
|----------|----------|
| Post-incident GitHub Issue (Mermaid timeline, severity, MTTR, escalation path) | GitHub Issues |
| Operational runbook (detect → triage → diagnose → resolve → verify → prevent) | `knowledge-base/runbooks/` |
| Prometheus / Alertmanager alerting rules | `knowledge-base/alerting-rules/` |
| Capacity planning recommendations | `knowledge-base/recommendations/` |
| Disaster recovery assessment | `knowledge-base/recommendations/` |
| Performance tuning guidance | `knowledge-base/recommendations/` |

### Knowledge Base Learning Loop

The agent reads past incidents before every diagnosis and appends new ones after every resolution. Over time it:
- Recognises recurring error patterns and references the prior incident ID
- Accelerates diagnosis with known resolutions
- Builds an organisational memory that survives team turnover

### Self-Healing CI Repair Loop

If an agent-generated fix PR fails CI, the repair agent kicks in automatically:

```
Fix PR → CI fails → Repair Agent
  → Reads CI error logs + original PR files
  → LLM generates corrected fix
  → New repair PR opened (labeled aiops-repair)
  → Original PR closed with link
  → CI runs on repair PR → human reviews & merges
```

**Loop protection:** If the repair PR also fails CI, the agent posts a comment asking for human help instead of looping.

---

## Zero External Dependencies

The agent uses **GitHub Models** (gpt-4o) authenticated with the standard `GITHUB_TOKEN`. No Anthropic key, no Azure subscription, no separate LLM service to manage.

| Concern | How it's handled |
|---------|-----------------|
| LLM authentication | `GITHUB_TOKEN` (built-in to every Actions run) |
| GitHub API | Same `GITHUB_TOKEN` via Octokit |
| On-prem / enterprise | Set `GITHUB_API_URL` to your GHE endpoint; add `GITHUB_MODELS_TOKEN` for a github.com PAT |

---

## Quick Start

### Option A — GitHub Actions (fully automated)

1. Fork this repo (must be on github.com — GitHub Models requires a github.com token)
2. Go to **Actions → SRE AIOps – Incident Response → Run workflow**
3. Select a scenario and click **Run workflow**
4. Watch the Issue and PR appear automatically

No secrets to configure. `GITHUB_TOKEN` is injected automatically by Actions.

### Option B — Run Locally

```bash
cd agent
npm ci

GITHUB_TOKEN=<github.com-PAT> \
GITHUB_REPO=<owner/repo> \
INCIDENT_SCENARIO=scenario-2-500-schema-drift \
node index.js
```

For GitHub Enterprise (e.g. github.tools.sap), add:

```bash
GITHUB_TOKEN=<ghe-PAT> \
GITHUB_MODELS_TOKEN=<github.com-PAT> \
GITHUB_API_URL=https://github.tools.sap/api/v3 \
GITHUB_REPO=<owner/repo> \
INCIDENT_SCENARIO=scenario-2-500-schema-drift \
node index.js
```

---

## Repo Structure

```
.github/workflows/
  incident-response.yml   # workflow_dispatch trigger — runs the full agent pipeline
  ci.yml                  # validates agent-generated fix PRs (Maven build + Flyway check)
  repair-fix.yml          # self-healing: auto-repairs failed fix PRs

agent/
  index.js                # orchestrator (8-step pipeline)
  repair.js               # self-healing repair agent
  github-client.js        # GitHub REST API wrapper (Octokit, GHE-compatible)
  llm-client.js           # GitHub Models wrapper (gpt-4o, retry + JSON parsing)
  prompts/
    diagnose.txt          # SAP BTP / CAP-aware diagnosis prompt
    remediate.txt         # fix generation prompt (6 remediation types)
    sre-artifacts.txt     # runbook + alerting rules + capacity/DR/perf artifacts
    repair.txt            # CI failure analysis + corrected fix generation
  output/
    create-issue.js       # post-incident Issue with Mermaid timeline + full SRE context
    create-pr.js          # fix PR creator (labels: aiops-generated)
    knowledge-base.js     # appends runbook entry to incidents.md
    commit-sre-artifacts.js  # commits runbook, alerting rules, recommendations

incidents/
  scenario-1-oom-cache/
  scenario-2-500-schema-drift/
  scenario-3-n-plus-one-timeout/
  scenario-4-xsuaa-auth/
  scenario-5-cap-deep-expand/       # SAP CAP / HANA pool exhaustion

knowledge-base/
  incidents.md            # learning loop knowledge base (seeded + auto-updated)
  runbooks/               # auto-generated operational runbooks
  alerting-rules/         # auto-generated Prometheus/Alertmanager rules
  recommendations/        # auto-generated capacity, DR, and performance recommendations

app/                      # Spring Boot bookshop microservice (demo target for scenarios 1-4)
```

---

## Demo Script

### Act 1 — The Incident
> "A developer merged PR #52 which removed a deprecated JPA field but forgot the Flyway migration. All `/api/books` endpoints are returning 500."

### Act 2 — The Agent Responds
> Trigger `scenario-2-500-schema-drift`. The agent reads the alert, fetches the blame PR diff, checks the knowledge base, and calls gpt-4o for diagnosis.

### Act 3 — 6 Artifacts in Under 2 Minutes
> 1. **GitHub Issue** — Mermaid incident timeline, severity score, MTTR estimate, escalation path, communication template
> 2. **Fix PR** — Generated Flyway migration, CI validates automatically
> 3. **Runbook** — `knowledge-base/runbooks/inc-2024-002.md` — full detect → resolve → prevent guide
> 4. **Alerting Rules** — `knowledge-base/alerting-rules/inc-2024-002.yml` — thresholds from incident metrics
> 5. **Recommendations** — capacity planning, DR assessment, performance tuning
> 6. **Knowledge Base** — incident logged in `incidents.md` for future learning

### Act 4 — The Learning Loop
> Trigger `scenario-4-xsuaa-auth`. The knowledge base already has an XSUAA incident (INC-2024-009). The agent references this past incident in its diagnosis.

### Act 5 — CAP / Feature Flag Scenario
> Trigger `scenario-5-cap-deep-expand`. Agent diagnoses `cds.features.deep_reads: true` as the blast radius, selects `feature_flag` remediation, generates a `package.json` patch disabling the flag.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Node.js 20, ES modules |
| LLM | GitHub Models — gpt-4o (`models.inference.ai.azure.com`) |
| GitHub Integration | Octokit REST (GitHub Enterprise compatible) |
| Application | Spring Boot 3.2.4, JDK 21 (scenarios 1-4) |
| CAP Application | SAP CAP Node.js, `@sap/cds` 7.x, HANA Cloud (scenario 5) |
| Database | PostgreSQL 16 / HANA Cloud, Flyway 10.x |
| CI/CD | GitHub Actions |

---

## Design Decisions

**No external secrets.** Using GitHub Models means the same `GITHUB_TOKEN` that already exists in every Actions run authenticates the LLM. There is nothing to configure, rotate, or pay for separately.

**Suggest, don't execute.** The agent drafts PRs but never merges or runs rollbacks autonomously. This matches "human in the loop" — teams can gradually expand autonomy (auto-merge low-risk migrations after CI, keep human approval for rollbacks).

**GitHub-native system of record.** Every incident, diagnosis, fix, and learned runbook lives as GitHub Issues, PRs, and markdown files. No separate dashboard, no external knowledge base.

**Continuous learning by design.** Past incidents feed back into the diagnosis prompt. The agent gets better with every run — the core promise of AIOps.
