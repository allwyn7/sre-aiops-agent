# SRE AIOps Agent — SAP Hackathon

An AI-powered incident response agent that automatically diagnoses production incidents, correlates them to recent code changes, generates remediation PRs, produces operational runbooks, creates alerting rules, and delivers capacity planning, disaster recovery, and performance tuning recommendations — all within GitHub.

> **"You build it, you run it"** — This agent bridges the gap between operational signals (error logs, metrics spikes, deployment events) and development artifacts (code changes, PRs, configuration diffs).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (workflow_dispatch)              │
│                                                                    │
│  ┌─────────┐    ┌─────────┐    ┌─────────────┐    ┌──────────┐  │
│  │  Alert   │───▶│ Agent   │───▶│ Claude LLM  │───▶│ GitHub   │  │
│  │  + Logs  │    │ (Node)  │    │ (Diagnosis  │    │ API      │  │
│  └─────────┘    │         │    │ + Remediate) │    │ (Issue+PR)│ │
│                  │         │    └─────────────┘    └──────────┘  │
│                  │         │                                      │
│                  │         │───▶ Knowledge Base (learning loop)   │
│                  └─────────┘    ◀── past incidents feed back ──  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Ingest** — Load alert payload (`alert.json`) + error logs (`logs.txt`) + recent merged PRs from GitHub
2. **Learn** — Fetch past resolved incidents from `knowledge-base/incidents.md` to identify recurring patterns
3. **Diagnose** — Claude analyzes logs, correlates with PR diffs, references past incidents, outputs root cause JSON
4. **Remediate** — Claude generates fix files (SQL migration, Java patch, config fix, or code change)
5. **SRE Artifacts** — Claude generates runbook, Prometheus alerting rules, capacity/DR/performance recommendations, and incident severity metadata in a single call
6. **Report** — Creates an enhanced post-incident GitHub Issue with Mermaid timeline, severity assessment, MTTR estimate, escalation path, communication template, and links to all generated artifacts
7. **Fix** — Opens a PR with the generated fix files; CI validates automatically
8. **Learn** — Appends a runbook entry to the knowledge base, commits runbook/alerting-rules/recommendations to `knowledge-base/`

---

## Incident Scenarios

| Scenario | Incident | Severity | Remediation Type | Root Cause |
|----------|----------|----------|-----------------|------------|
| `scenario-1-oom-cache` | OutOfMemoryError from unbounded HashMap cache | P1 | `code_fix` | PR #48 added static HashMap cache with no eviction — heap exhausted under load |
| `scenario-2-500-schema-drift` | HTTP 500 — Hibernate SQLGrammarException | P1 | `flyway_migration` | PR #52 removed JPA field but no Flyway migration dropped the DB column |
| `scenario-3-n-plus-one-timeout` | Request timeouts — DB connection pool exhausted | P2 | `code_fix` | PR #55 changed fetch type to EAGER, causing N+1 queries (1,205 SQL queries per request) |
| `scenario-4-xsuaa-auth` | HTTP 401/403 — XSUAA token validation failure | P1 | `config_fix` | PR #58 updated `xsappname` without re-creating service bindings — audience mismatch |

Each scenario includes realistic SAP BTP-style alert payloads and application logs with full stack traces.

---

## Key Features

### 6 SRE Capabilities Per Incident

Every incident run generates a comprehensive set of SRE artifacts:

| Capability | Output | Location |
|------------|--------|----------|
| **Incident Response Analysis** | Severity scoring, MTTR estimate, escalation path, communication template | GitHub Issue (enhanced) |
| **Runbook Generation** | Full operational runbook (detection, triage, diagnosis, resolution, verification, prevention) | `knowledge-base/runbooks/` |
| **Alerting Rules Creation** | Prometheus/Alertmanager YAML with thresholds derived from incident metrics | `knowledge-base/alerting-rules/` |
| **Capacity Planning** | Scaling thresholds, resource recommendations, growth projections | `knowledge-base/recommendations/` |
| **Disaster Recovery Planning** | SPOF analysis, HA recommendations, failover strategy, RTO/RPO assessment | `knowledge-base/recommendations/` |
| **Performance Tuning** | JVM, Spring Boot, JPA/Hibernate, PostgreSQL, HikariCP tuning | `knowledge-base/recommendations/` |

### Knowledge Base Learning Loop
The agent doesn't just fix incidents — it **learns from them**. Each resolved incident is appended to `knowledge-base/incidents.md` with its error pattern, root cause, and resolution. On subsequent incidents, the agent reads past entries and uses them to:
- Identify recurring error patterns instantly
- Accelerate diagnosis with known resolutions
- Reference prior incident IDs in the post-incident report

### Visual Incident Timeline
Every post-incident GitHub Issue includes a **Mermaid timeline diagram** showing:
```
Deployment → Metrics spike → Alert fired → Agent diagnosis → Fix PR created
```
This makes the incident correlation visible at a glance.

### Correlation Evidence Table
Issues include a metrics table showing every signal from the alert (error rates, response times, baselines) — giving reviewers the full picture without leaving GitHub.

### Resilient Agent
- **Retry logic** with exponential backoff for Claude API rate limits and transient errors
- **Multi-layer JSON parsing** (direct parse → fence stripping → regex extraction)
- **Graceful degradation** when blame PR diff is unavailable (uses alert metadata instead)
- **Failure summaries** written to GitHub Actions step summary on error

### Self-Healing CI Repair Loop
If a generated fix PR fails CI, the agent **automatically repairs it**:

```
Fix PR created → CI fails → Repair Agent triggers
  → Reads CI error logs + original PR files
  → LLM generates corrected fix
  → New repair PR created (labeled aiops-repair)
  → Original PR closed with link to repair
  → CI runs on repair PR → human reviews & merges
```

**Loop protection:** Repair PRs are labeled `aiops-repair` — if a repair also fails CI, the agent stops and posts a comment asking for human help instead of looping infinitely.

---

## Repo Structure

```
.github/workflows/
  incident-response.yml   # workflow_dispatch trigger — runs the agent
  ci.yml                  # validates agent-generated fix PRs
  repair-fix.yml          # auto-repairs failed fix PRs (self-healing loop)

agent/
  index.js                # orchestrator (8-step pipeline)
  repair.js               # self-healing repair agent (triggered on CI failure)
  github-client.js        # GitHub REST API wrapper (Octokit)
  llm-client.js           # Claude API wrapper with retry logic
  prompts/
    diagnose.txt          # SAP BTP-aware diagnosis prompt (with KB context)
    remediate.txt         # fix file generation prompt (4 remediation types)
    sre-artifacts.txt     # generates runbook, alerting rules, capacity/DR/perf recommendations
    repair.txt            # self-healing prompt: analyzes CI failure, generates corrected fix
  output/
    create-issue.js       # enhanced post-incident Issue with severity, MTTR, escalation, artifacts
    create-pr.js          # fix PR creator
    knowledge-base.js     # appends runbook entries to incidents.md
    commit-sre-artifacts.js  # commits runbook, alerting rules, recommendations to KB
  package.json

app/                      # Spring Boot bookshop microservice (demo target)
  src/main/java/com/sap/demo/bookshop/
    entity/Book.java      # JPA entity (incident trigger for scenario 2)
    entity/Author.java
    controller/BookController.java
    service/BookService.java
    repository/BookRepository.java
  src/main/resources/
    application.yml       # PostgreSQL + Flyway + Actuator
    application-test.yml  # H2 in-memory for CI
    db/migration/
      V1__initial_schema.sql
  Dockerfile
  pom.xml                 # Spring Boot 3.2.4, JDK 21

incidents/
  scenario-1-oom-cache/           # OOM from unbounded cache
  scenario-2-500-schema-drift/    # Schema drift (JPA vs DB mismatch)
  scenario-3-n-plus-one-timeout/  # N+1 query explosion
  scenario-4-xsuaa-auth/          # XSUAA authentication failure

knowledge-base/
  incidents.md            # auto-populated runbook (seeded with 3 historical incidents)
  runbooks/               # auto-generated operational runbooks per incident
  alerting-rules/         # auto-generated Prometheus/Alertmanager rules per incident
  recommendations/        # auto-generated capacity, DR, and performance recommendations

docker-compose.yml        # PostgreSQL + bookshop-srv for local dev
```

---

## Quick Start

### Prerequisites
- GitHub repo with Actions enabled
- `ANTHROPIC_API_KEY` set as a repository secret

### Run the Demo

1. Go to **Actions → SRE AIOps – Incident Response → Run workflow**
2. Select a scenario (e.g., `scenario-2-500-schema-drift`)
3. Optionally enter a GitHub Issue number to post the diagnosis as a comment
4. Click **Run workflow**

### What Happens

In under 3 minutes:
- A **post-incident GitHub Issue** appears with:
  - Mermaid incident timeline
  - Root cause analysis with blame PR
  - Correlation evidence table
  - Severity assessment (1-10 score, impact/urgency matrix)
  - MTTR estimate with justification
  - Escalation path
  - Stakeholder communication template (collapsible)
  - Links to all generated SRE artifacts
  - Knowledge base cross-reference (if pattern matches a past incident)
- A **fix PR** opens with the generated fix files
- CI validates the fix (Maven build + Flyway sequence check)
- **SRE artifacts** are committed to `knowledge-base/`:
  - `runbooks/{incident-id}.md` — full operational runbook
  - `alerting-rules/{incident-id}.yml` — Prometheus alerting rules
  - `recommendations/{incident-id}.md` — capacity planning, DR assessment, performance tuning
- `knowledge-base/incidents.md` is updated with a new runbook entry

### Local Development

```bash
docker compose up -d postgres
cd app && mvn spring-boot:run
# App running at http://localhost:8080/api/books
```

---

## Demo Script (for judges)

### Act 1: The Incident
> "A developer merged PR #52 which removed a deprecated JPA field, but forgot the Flyway migration. All /api/books endpoints are now returning 500."

### Act 2: The Agent Responds
> Trigger `scenario-2-500-schema-drift` from the Actions tab. The agent reads the alert, fetches the blame PR diff, checks the knowledge base, and calls Claude for diagnosis.

### Act 3: The Output — 6 Artifacts from 1 Incident
> 1. **GitHub Issue** — Show the Mermaid timeline, severity assessment (score, impact, urgency), MTTR estimate, escalation path, and collapsible communication template.
> 2. **Fix PR** — Show the generated Flyway migration and CI passing.
> 3. **Runbook** — Open `knowledge-base/runbooks/inc-2024-002.md` — a full 6-section operational runbook (detect, triage, diagnose, resolve, verify, prevent).
> 4. **Alerting Rules** — Open `knowledge-base/alerting-rules/inc-2024-002.yml` — Prometheus rules with thresholds derived from the incident metrics.
> 5. **Recommendations** — Open `knowledge-base/recommendations/inc-2024-002.md` — capacity planning, disaster recovery assessment, and performance tuning guidance.
> 6. **Knowledge Base** — The incident is logged in `incidents.md` for future learning.

### Act 4: The Learning Loop
> Now trigger `scenario-4-xsuaa-auth`. Point out the knowledge base already has an XSUAA incident (INC-2024-009). The agent references this past incident in its diagnosis — it's getting smarter.

### Act 5: The Flywheel
> Open `knowledge-base/` — it now has runbooks, alerting rules, and recommendations from both runs. Every incident makes the next diagnosis faster, the alerting better, and the team more prepared. The repository becomes the system of record.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Node.js 20, ES modules |
| LLM | Claude (Anthropic API) |
| GitHub Integration | Octokit REST |
| Application | Spring Boot 3.2.4, JDK 21 |
| Database | PostgreSQL 16, Flyway 10.x |
| CI/CD | GitHub Actions |
| Container | Docker (Alpine JDK 21) |

---

## Design Decisions

**Why suggest, not execute?** The agent drafts PRs but never merges or runs rollbacks. This matches SAP's "human in the loop" philosophy. Teams can gradually expand autonomy: auto-merge low-risk migrations after CI passes, but keep human approval for rollbacks and schema drops.

**Why GitHub-native?** The repository becomes the system of record — all incidents, diagnoses, fixes, and learnings are tracked as Issues, PRs, and markdown files. No separate dashboard needed.

**Why a knowledge base?** The brief calls for "organizational learning" and a "searchable knowledge base." By feeding past incidents back into the diagnosis prompt, the agent demonstrates continuous improvement — the core promise of AIOps.
