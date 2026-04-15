---
marp: true
theme: default
paginate: true
backgroundColor: #fff
color: #24292e
style: |
  section {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    padding: 40px 60px;
  }
  h1 { color: #0366d6; font-size: 2em; }
  h2 { color: #24292e; border-bottom: 3px solid #0366d6; padding-bottom: 8px; }
  h3 { color: #0366d6; }
  table { font-size: 0.72em; width: 100%; }
  th { background: #0366d6; color: white; padding: 6px 10px; }
  td { padding: 5px 10px; }
  tr:nth-child(even) { background: #f6f8fa; }
  code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; }
  blockquote { border-left: 4px solid #0366d6; color: #586069; margin: 10px 0; padding: 8px 16px; background: #f6f8fa; }
  .done { color: #28a745; font-weight: bold; }
  .inprog { color: #f66a0a; font-weight: bold; }
  .planned { color: #0366d6; font-weight: bold; }
  ul { line-height: 1.8; }
  li { margin: 4px 0; }
---

# SRE AIOps Agent
### End-to-End GitHub-Native Incident Response for SAP

**Azure Monitor alert → GitHub Copilot diagnosis → Fix PR → Runbook — in under 2 minutes**

SAP Hackathon 2026 · Midpoint Review

---

## The Platform — 100% Microsoft / GitHub Stack

**Every component runs on infrastructure you already own**

```
Azure Monitor Alert
        │
        ▼
GitHub Actions Workflow ◄── repository_dispatch webhook
        │
        ▼
GitHub Models (gpt-4o)  ◄── same Azure OpenAI infra as Copilot
  • Diagnose root cause
  • Generate targeted fix
  • Write SRE artifacts
        │
        ▼
GitHub REST API (Octokit)
  • Open Fix PR          → GitHub Pull Request
  • Create Incident Log  → GitHub Issue (Mermaid timeline)
  • Commit Runbook       → GitHub repository
        │
        ▼
GitHub Copilot Chat + MCP
  • SRE asks: "what happened?" → Copilot calls GitHub tools to answer
  • SRE asks: "trigger the agent" → Copilot dispatches the workflow
```

> **Zero external services.** No PagerDuty. No Jira. No external LLM API key.

---

## The Problem

**SAP's "you build it, you run it" culture means developers carry on-call burden**

| Step | Time Spent | Pain Point |
|------|-----------|------------|
| Read through logs in BTP / Azure Monitor | 10-20 min | Hundreds of lines, no structure |
| Cross-reference recent PRs on GitHub | 10-15 min | Manual timeline correlation |
| Identify the root cause | 5-20 min | Requires deep domain knowledge |
| Write and test a fix | 15-30 min | Under pressure, often incomplete |
| Document the incident | 10-20 min | Usually skipped or done days later |

> **Total: 30-90 minutes of skilled engineer time per incident — often at 2am**

Knowledge stays in people's heads. Runbooks go stale. The next engineer faces the same incident from scratch.

---

## Our Solution

**GitHub Copilot-backed agent that automates the full incident response lifecycle**

```
Azure Monitor / SAP BTP Alert
        │
        ▼
┌─────────────────────────────────────────────────────┐
│              SRE AIOps Agent                        │
│                                                     │
│  INGEST → LEARN → DIAGNOSE → REMEDIATE → DOCUMENT  │
│                                                     │
│  alert.json  past     gpt-4o   fix files   Issue   │
│  logs.txt    incidents root    + PR        Runbook  │
│  recent PRs  KB        cause   6 types     Alerts  │
└─────────────────────────────────────────────────────┘
        │
        ▼
  Fix PR opens → CI validates → SRE reviews → Merge
        │
        └─ CI fails? → Repair agent → Corrected PR
```

**SRE role is reduced to: review the diff and click merge**

---

## GitHub Copilot Chat — The SRE Interface

**SRE types a question in VS Code. Copilot calls GitHub tools to answer.**

Using the official **GitHub MCP Server** (26 tools, configured against `github.tools.sap`):

```
SRE in VS Code Copilot Chat:
  "@workspace What happened with INC-AZ-2024-001?"

Copilot calls MCP tools:
  → search_issues(label: "incident", "INC-AZ-2024-001")
  → get_file_contents("knowledge-base/runbooks/inc-az-2024-001.md")
  → get_pull_request(#71)

Copilot responds:
  "Root cause: bulk order query with no LIMIT clause saturated the Azure SQL
   connection pool. Fix PR #71 adds pagination (page size 100). CI passing.
   Runbook says: verify DTU drops below 50% after merge."
```

**Pre-built prompts in `.github/prompts/`:**
- `/list-incidents` — show all open incidents and fix PR status
- `/trigger-agent` — dispatch the agent for a chosen scenario
- `/investigate-incident` — deep-dive on a specific incident
- `/review-fix-pr` — approve/hold/reject with verification checklist

---

## Azure Monitor Integration

**Real-world trigger: Azure Monitor fires → GitHub Actions runs → Fix PR opens**

```
Azure Monitor Action Group
  Webhook → POST /repos/{owner}/{repo}/dispatches
  event_type: azure-monitor-alert
  client_payload: { azure_alert: <Common Alert Schema> }
        │
        ▼
GitHub Actions: azure-monitor-trigger.yml
  • Normalizes Azure Common Alert Schema → agent alert format
  • Maps Sev0/Sev1 → P1, Sev2 → P2, Sev3-4 → P3
  • Extracts service name from Azure resource ID
  • Passes blame PR number from client_payload
        │
        ▼
Same agent pipeline — no changes needed
  • Diagnosis, Fix PR, Issue, Runbook, Alerting Rules
```

**Two Azure Monitor scenarios:**
- `azure-monitor-http5xx` — bulk order endpoint with no LIMIT clause → Azure SQL pool exhaustion → `code_fix`
- `azure-monitor-sql-pool` — eager-loaded purchase history → DTU spike → `code_fix`

---

## Architecture — Technical Decisions

**Three layers, zero external dependencies**

```
┌──────────────────────────────────────────────────────────┐
│  TRIGGER LAYER                                           │
│  GitHub Actions (workflow_dispatch)                      │
│  Azure Monitor webhook (repository_dispatch)             │
│  SAP Alert Notification webhook (same endpoint)          │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  INTELLIGENCE LAYER                                      │
│  GitHub Models (gpt-4o) — Azure OpenAI infrastructure   │
│  Authenticated via GITHUB_TOKEN — no separate API key    │
│  3 LLM calls: diagnose · remediate · sre-artifacts       │
│  Confidence gate: low → force pr_rollback (safe)         │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  GITHUB LAYER                                            │
│  Octokit REST · GitHub MCP Server (26 tools)             │
│  Issues · Pull Requests · Branches · Knowledge Base      │
│  Targets: github.tools.sap (on-prem) or github.com       │
└──────────────────────────────────────────────────────────┘
```

---

## SRE Confidence — Why the Agent Can Be Trusted

**The agent shows its work. It never takes irreversible actions without approval.**

| Feature | What it does |
|---------|-------------|
| **Evidence trail** | Every GitHub Issue lists: which logs were analyzed, which PRs were reviewed, why blame PR was chosen |
| **Confidence gate** | `low` confidence → auto-downgrade to `pr_rollback` (rollback is always safe) |
| **Confidence warning** | `[!WARNING]` block at top of Issue when confidence is not `high` |
| **CI validates first** | Fix PR must pass CI before it appears in SRE's review queue |
| **Self-healing loop** | If CI fails, repair agent reads error logs and opens corrected PR |
| **Knowledge base** | Agent references past incidents — "this matches INC-2023-017" |
| **Human gate** | All PRs require manual merge — agent suggests, SRE approves |

> **Gradual autonomy path:** Start with human review of every PR. After 30 days of validated fixes, auto-merge `feature_flag` type on CI pass. Build trust incrementally.

---

## 7 Incident Scenarios — SAP + Azure Realistic

| Scenario | Platform | Severity | Root Cause | Fix Type |
|----------|---------|----------|------------|----------|
| OOM — unbounded cache | Spring Boot / BTP | P1 | HashMap cache, no eviction, heap 98.7% | `code_fix` |
| HTTP 500 — schema drift | Spring Boot / BTP | P1 | JPA field removed, Flyway migration missing | `flyway_migration` |
| Timeouts — N+1 queries | Spring Boot / BTP | P2 | LAZY→EAGER fetch, 1,205 SQL/request | `code_fix` |
| HTTP 403 — XSUAA auth | BTP / CF | P1 | xsappname changed, bindings not re-created | `config_fix` |
| OData timeout — HANA pool | **SAP CAP** | P2 | `deep_reads: true`, 340 HANA queries/request | `feature_flag` |
| HTTP 5xx — Azure SQL pool | **Azure Monitor** | P1 | No LIMIT clause, connection pool saturated | `code_fix` |
| DTU spike — eager load | **Azure Monitor** | P2 | Full purchase history loaded in-memory | `code_fix` |

---

## What the Agent Produces (Per Incident)

**7 artifacts from a single run — everything a team needs**

| # | Artifact | Content |
|---|----------|---------|
| 1 | **GitHub Issue** | Mermaid timeline · Evidence trail · Confidence warning · Severity 1-10 · MTTR · Escalation · Comms template |
| 2 | **Fix PR** | Generated code (SQL migration / Java patch / config / flag toggle) · CI-validated |
| 3 | **Operational Runbook** | Detect → Triage → Diagnose → Resolve → Verify → Prevent |
| 4 | **Prometheus Alerting Rules** | YAML with thresholds derived from incident metrics |
| 5 | **Recommendations** | Capacity planning · DR assessment · Performance tuning |
| 6 | **Knowledge Base Entry** | Pattern + root cause + resolution · Fed back into future diagnoses |
| 7 | **Copilot Chat answers** | SRE asks questions in VS Code; MCP tools query GitHub to answer |

---

## Self-Healing CI Repair Loop

**What happens when the agent's own fix is wrong**

```
Fix PR created (labeled: aiops-generated)
         │
    CI validates ──── PASS ──▶ SRE reviews → Merge
         │
        FAIL
         │
  Repair Agent triggers
  • Reads CI error logs (Maven output, Flyway errors, test failures)
  • Reads original fix files from PR
  • Calls gpt-4o: "Here is what failed. Generate a corrected fix."
         │
  New repair PR opened (labeled: aiops-repair)
  Original PR closed with link and explanation
         │
    CI validates ──── PASS ──▶ SRE reviews → Merge
         │
        FAIL
         │
  "⚠️ Needs human intervention" — loop halted, SRE escalated
```

**Most AI tools fail silently. This one corrects itself.**

---

## Knowledge Base — The Learning Loop

**The agent gets smarter with every incident**

```
Incident fires
      │
Agent reads knowledge-base/incidents.md
  "5 past incidents loaded"
  "Pattern match: column does not exist → INC-2023-017 (Flyway collision)"
      │
LLM diagnosis references past incident
  "This resembles INC-2023-017 — resolution was a Flyway migration"
      │
Resolution committed → knowledge base updated
  "INC-2024-002 appended for future reference"
```

**Seeded with SAP-style incidents:**
- Flyway migration version collision
- HikariCP pool exhaustion (missing `@Transactional`)
- XSUAA audience mismatch after BTP plan migration
- CAP `deep_reads` HANA pool exhaustion
- Azure SQL connection pool exhaustion

> Organisational memory that survives team turnover

---

## Live Demo Results — Scenario 2 (Verified on GitHub Actions)

**Ran on `github.com/allwyn7/sre-aiops-agent`**

| Output | Result |
|--------|--------|
| Root cause | `price_old` column in DB, removed from JPA entity |
| Blame PR | #52 — "Remove deprecated priceOld field" |
| Fix generated | `V2__drop_price_old_column.sql` — correct Flyway migration |
| GitHub Issue | Mermaid timeline · Evidence trail · Severity 9/10 · MTTR 30 min |
| Runbook | `knowledge-base/runbooks/inc-2024-002.md` |
| Alerting rules | `knowledge-base/alerting-rules/inc-2024-002.yml` |
| Recommendations | `knowledge-base/recommendations/inc-2024-002.md` |
| Knowledge base | INC-2024-002 appended to `incidents.md` |

**Total time: under 2 minutes · Zero manual steps**

Repo: **github.com/allwyn7/sre-aiops-agent**

---

## Implementation Plan — Phase 1 ✅ COMPLETE

| Component | Status |
|-----------|--------|
| 8-step agent pipeline | ✅ Done |
| GitHub Models (gpt-4o) LLM integration | ✅ Done |
| 6 remediation types | ✅ Done |
| Fix PR + CI validation | ✅ Done |
| Post-incident GitHub Issue (Mermaid + evidence trail) | ✅ Done |
| SRE artifacts (runbook, alerting rules, recommendations) | ✅ Done |
| Self-healing repair loop | ✅ Done |
| Knowledge base learning loop | ✅ Done |
| Confidence gate (low → pr_rollback) | ✅ Done |
| 7 incident scenarios (5 SAP + 2 Azure Monitor) | ✅ Done |
| GitHub Actions workflows (3 workflows) | ✅ Done |
| Azure Monitor webhook adapter + workflow | ✅ Done |
| GitHub MCP server (26 tools, github.tools.sap) | ✅ Done |
| GitHub Copilot Chat prompts (4 prompts) | ✅ Done |
| Copilot instructions for repo | ✅ Done |

---

## Implementation Plan — Phase 2 🔄 IN PROGRESS

| Component | Status |
|-----------|--------|
| VS Code Copilot Chat end-to-end demo (MCP + prompts) | 🔄 In Progress |
| Run all 7 scenarios on GitHub Actions | 🔄 In Progress |
| Azure Monitor live webhook test (real Action Group) | 📋 Pending |
| Demo self-healing loop (intentional CI break) | 📋 Pending |
| Demo learning loop (scenario-4 → reference past XSUAA incident) | 📋 Pending |

## Production Path — Phase 3 📋

| Feature | Effort |
|---------|--------|
| Real Azure Monitor Action Group → GitHub dispatch | Low |
| SAP Alert Notification Service webhook | Low |
| SAP on-prem Copilot LLM (replace GitHub Models endpoint) | Low |
| Slack/Teams notification on incident trigger | Low |
| Auto-merge `feature_flag` fixes after 30-day trust period | Medium |

---

## Feedback We Need from the Jury

**Three open questions:**

**1. Azure Monitor integration depth**
We normalize Azure Monitor alerts into our pipeline. Should we also pull Azure Log Analytics logs via KQL at diagnosis time — replacing the static `logs.txt` with real-time Azure data?

**2. Copilot Chat demo**
We have 4 pre-built prompts the SRE can run in Copilot Chat. Which is most impressive to demo live: triggering the agent, or investigating a past incident end-to-end?

**3. Autonomy level for Azure**
For low-risk Azure Monitor alerts (e.g. feature flag toggle to reduce load), should the agent be allowed to auto-merge without human review when CI passes and confidence=high?

---

# Summary

> *An SRE AIOps agent running 100% on GitHub and Azure infrastructure — Azure Monitor fires, GitHub Actions runs the agent powered by GitHub Models (Azure OpenAI), a CI-validated fix PR opens, and the SRE gets a full runbook, alerting rules, and evidence trail — in under 2 minutes.*

**What's done:** Full pipeline · 7 scenarios · 6 fix types · Azure Monitor adapter · MCP + Copilot Chat prompts · Confidence gate · Self-healing loop

**What's next:** Live Copilot Chat demo · All scenarios on Actions · Azure live webhook

**Repo:** github.com/allwyn7/sre-aiops-agent

---

*Thank you — questions welcome*
