# SRE AIOps Agent

A GitHub Copilot-backed incident response agent that automatically diagnoses production incidents, correlates them to recent code changes, generates remediation PRs, produces operational runbooks, and learns from every incident — all within GitHub, with zero external dependencies.

> **"You build it, you run it"** — This agent bridges the gap between operational signals (error logs, metrics spikes, deployment events) and development artifacts (code changes, PRs, configuration diffs).

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                   Incident Trigger                               │
│      (GitHub Actions workflow_dispatch, repository_dispatch,     │
│       Azure Monitor webhook, or local CLI)                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │      Agent (Node.js)       │
              │                           │
              │  1. Load alert + logs      │
              │  2. Fetch recent PRs       │
              │     (skip if infra)        │
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
              │  • Open fix PR (code/IaC)  │
              │  • Commit runbooks/rules   │
              │  • Update knowledge base   │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐  (infrastructure only)
              │   GitHub Actions Dispatch  │
              │                           │
              │  • Trigger remediation     │
              │    workflow (scale K8s,    │
              │    rotate certs, update    │
              │    network policies)       │
              │  • Comment result on Issue │
              └───────────────────────────┘
```

### Pipeline Steps

1. **Ingest** — Load `alert.json` + `logs.txt` + recent merged PRs + blame PR diff from GitHub (PRs skipped for infrastructure incidents)
2. **Learn** — Read `knowledge-base/incidents.md` to identify recurring patterns from past incidents
3. **Diagnose** — LLM correlates logs, PR diffs (or infrastructure signals), and past incidents; outputs structured root cause JSON
4. **Remediate** — LLM generates fix files (Flyway migration, code patch, config fix, feature flag toggle, IaC manifests, or rollback)
5. **SRE Artifacts** — LLM generates runbook, Prometheus alerting rules, capacity/DR/performance recommendations
6. **Report** — Creates a post-incident GitHub Issue with Mermaid timeline, severity, MTTR estimate, escalation path, and artifact links
7. **Fix PR** — Opens a PR with generated fix files; CI validates automatically (skipped for escalation-only incidents)
8. **Infrastructure Dispatch** — For `infrastructure_action` incidents: dispatches a GitHub Actions workflow to execute the remediation (scale K8s, rotate certs, update network policies)
9. **Learn** — Appends incident entry to knowledge base; commits runbook, alerting rules, and recommendations

---

## Incident Scenarios

### Application Incidents (blame PR → code fix)

| Scenario | Incident | Severity | Remediation Type | Root Cause |
|----------|----------|----------|-----------------|------------|
| `scenario-1-oom-cache` | OutOfMemoryError — heap exhausted | P1 | `code_fix` | PR #48 added unbounded static HashMap cache with no eviction |
| `scenario-2-500-schema-drift` | HTTP 500 — Hibernate SQLGrammarException | P1 | `flyway_migration` | PR #52 removed JPA field but no Flyway migration dropped the DB column |
| `scenario-3-n-plus-one-timeout` | Request timeouts — connection pool exhausted | P2 | `code_fix` | PR #55 changed fetch type to EAGER, causing 1,205 SQL queries per request |
| `scenario-4-xsuaa-auth` | HTTP 401/403 — XSUAA token validation failure | P1 | `config_fix` | PR #58 updated `xsappname` without re-creating service bindings |
| `scenario-5-cap-deep-expand` | OData timeouts — HANA pool exhausted | P2 | `feature_flag` | PR #62 enabled `deep_reads` in CAP `package.json`, generating 300+ HANA queries per request |

### Infrastructure Incidents (no blame PR → IaC fix + workflow dispatch)

| Scenario | Incident | Severity | Remediation Type | Root Cause |
|----------|----------|----------|-----------------|------------|
| `scenario-6-k8s-pod-crashloop` | Pods CrashLoopBackOff — OOMKilled | P1 | `infrastructure_action` | Traffic spike exceeded container memory limits (512Mi), HPA maxed at 3 replicas |
| `scenario-7-tls-cert-expiry` | HTTPS handshake failures — cert expired | P1 | `infrastructure_action` | cert-manager HTTP-01 solver misconfigured, Let's Encrypt cert expired without renewal |
| `scenario-8-dns-network-policy` | Inter-service DNS timeouts | P2 | `escalation` | K8s 1.28→1.29 cluster upgrade changed network policy semantics, blocking DNS egress to kube-system |

---

## Key Features

### 8 Remediation Types

The agent selects the appropriate fix strategy based on the diagnosis:

| Type | When Used | Example |
|------|-----------|---------|
| `flyway_migration` | DB schema drifted from JPA entity | Add `DROP COLUMN` migration |
| `code_fix` | Bug introduced in application code | Fix N+1 query, add cache eviction |
| `config_fix` | Misconfigured service binding or app config | Correct `xsappname`, update bindings |
| `feature_flag` | New feature flag causing blast radius | Set `cds.features.deep_reads: false` |
| `pr_rollback` | P0/P1 where reverting is fastest mitigation | Generate files in pre-PR state |
| `dependency_update` | Vulnerable or broken dependency version | Bump version in `pom.xml` / `package.json` |
| `infrastructure_action` | Infrastructure config change needed | K8s resource scaling, cert rotation, network policy update — generates IaC PR + dispatches GitHub Actions workflow |
| `escalation` | Requires human/external intervention | Cloud provider ticket, manual DNS change, complex cross-team coordination |

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

### GitHub Copilot Chat Integration

The agent integrates with GitHub Copilot Chat as an interactive SRE assistant. Using the GitHub MCP server (`.vscode/mcp.json`) and agent-mode prompts (`.github/prompts/`), SREs can investigate and respond to incidents directly from their IDE:

| Command | What It Does |
|---------|-------------|
| `@workspace /sre-diagnose scenario-6-k8s-pod-crashloop` | Interactively diagnose an incident — reads alerts, logs, blame PRs, and knowledge base via MCP |
| `@workspace /sre-status` | Live incident dashboard — shows all open incidents, fix PRs, and their current status |
| `@workspace /sre-remediate scenario-2-500-schema-drift` | Trigger the full agent pipeline and monitor the remediation lifecycle |
| `@workspace /review-fix-pr 42` | SRE code review of a fix PR with merge/hold/reject recommendation |

The MCP server provides Copilot with direct access to GitHub Issues, PRs, and repository contents — making Copilot a conversational SRE agent without any external services.

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
  infra-remediation.yml   # infrastructure remediation: scale K8s, rotate certs, update policies
  azure-monitor-trigger.yml  # Azure Monitor webhook → agent pipeline

agent/
  index.js                # orchestrator (9-step pipeline, handles app + infra incidents)
  repair.js               # self-healing repair agent
  github-client.js        # GitHub REST API wrapper (Octokit, GHE-compatible, workflow dispatch)
  llm-client.js           # GitHub Models wrapper (gpt-4o, retry + JSON parsing)
  adapters/
    azure-monitor.js      # Azure Monitor Common Alert Schema → agent alert format
  prompts/
    diagnose.txt          # SAP BTP / CAP / infrastructure-aware diagnosis prompt
    remediate.txt          # fix generation prompt (8 remediation types)
    sre-artifacts.txt     # runbook + alerting rules + capacity/DR/perf artifacts
    repair.txt            # CI failure analysis + corrected fix generation
  output/
    create-issue.js       # post-incident Issue with Mermaid timeline + full SRE context
    create-pr.js          # fix PR creator (labels: aiops-generated, infrastructure)
    knowledge-base.js     # appends runbook entry to incidents.md
    commit-sre-artifacts.js  # commits runbook, alerting rules, recommendations
    dispatch-remediation.js  # dispatches infra-remediation.yml workflow

incidents/
  scenario-1-oom-cache/
  scenario-2-500-schema-drift/
  scenario-3-n-plus-one-timeout/
  scenario-4-xsuaa-auth/
  scenario-5-cap-deep-expand/
  scenario-6-k8s-pod-crashloop/     # K8s pods OOMKilled, CrashLoopBackOff
  scenario-7-tls-cert-expiry/       # TLS cert expired, HTTPS failures
  scenario-8-dns-network-policy/    # DNS blocked by network policy after upgrade

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

### Act 6 — Infrastructure Incident (No Blame PR)
> Trigger `scenario-6-k8s-pod-crashloop`. The agent detects there is no blame PR, skips PR context fetching, and diagnoses a **Kubernetes infrastructure failure**: pods OOMKilled due to container memory limits exceeded during a traffic spike. The agent:
> 1. Creates a **GitHub Issue** with an infrastructure-specific timeline (no PR reference)
> 2. Generates an **IaC fix PR** with updated K8s deployment resource limits and HPA configuration
> 3. **Dispatches a GitHub Actions remediation workflow** (`infra-remediation.yml`) to execute the scaling
> 4. The workflow posts a comment back on the incident issue confirming remediation was executed

### Act 7 — TLS Certificate Expiry
> Trigger `scenario-7-tls-cert-expiry`. Agent diagnoses an expired TLS certificate (cert-manager renewal failures), selects `infrastructure_action`, generates a corrected cert-manager Certificate resource, and dispatches the cert rotation workflow.

### Act 8 — Network Policy / Escalation
> Trigger `scenario-8-dns-network-policy`. Agent diagnoses DNS resolution blocked by network policies after a K8s 1.28→1.29 cluster upgrade. Confidence is medium, and the fix requires cross-team coordination. Agent selects `escalation`, creates a detailed escalation issue with investigation commands — no PR, no automated fix. Human-in-the-loop for complex infrastructure.

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

**GitHub Actions as infrastructure orchestration.** For infrastructure incidents, the agent dispatches GitHub Actions workflows to execute remediation (scale K8s resources, rotate certificates, update network policies). This demonstrates that GitHub Actions is not just CI/CD — it's a full infrastructure automation layer.

**Application + Infrastructure, same pipeline.** The same agent handles both application bugs (traced to a blame PR) and infrastructure failures (no blame PR). The pipeline adapts: it skips PR context for infra incidents, uses infrastructure-specific diagnosis, generates IaC files instead of code patches, and dispatches remediation workflows. One tool for all SRE incident response.

**Continuous learning by design.** Past incidents feed back into the diagnosis prompt. The agent gets better with every run — the core promise of AIOps. Infrastructure incidents are included in the knowledge base alongside application incidents, building a complete operational memory.
