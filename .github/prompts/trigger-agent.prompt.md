---
mode: agent
description: Trigger the SRE AIOps Agent for a specific incident scenario via GitHub Actions
---

You are acting as an SRE assistant. Use GitHub tools to trigger and monitor the AIOps agent.

**Input required:** Provide the scenario name. Valid values:
- `scenario-1-oom-cache` — Spring Boot OOM, unbounded in-memory cache (P1)
- `scenario-2-500-schema-drift` — HTTP 500 schema drift, missing Flyway migration (P1)
- `scenario-3-n-plus-one-timeout` — Timeouts from N+1 query problem (P2)
- `scenario-4-xsuaa-auth` — HTTP 403 XSUAA auth failure after BTP plan change (P1)
- `scenario-5-cap-deep-expand` — SAP CAP OData timeout, HANA pool exhaustion (P2)
- `scenario-6-k8s-pod-crashloop` — **Infrastructure:** K8s pods OOMKilled, CrashLoopBackOff after traffic spike (P1)
- `scenario-7-tls-cert-expiry` — **Infrastructure:** TLS certificate expired, HTTPS handshake failures (P1)
- `scenario-8-dns-network-policy` — **Infrastructure:** DNS/network policy failure after cluster upgrade (P2)

Steps:

1. Use `create_or_update_file` or `trigger_workflow` / `create_workflow_dispatch` to trigger the `incident-response.yml` GitHub Actions workflow with the chosen scenario.
   - The workflow input is: `incident_scenario: <scenario-name>`

2. Use `list_workflow_runs` to monitor the workflow run status. Check every 30 seconds until it completes (status: `completed`).
   - Report the run URL and whether it passed or failed.

3. Once the run completes successfully, use `search_issues` to find the newly created post-incident issue.
   - Show: issue URL, severity, root cause summary, confidence level.

4. Use `list_pull_requests` to find the fix PR that was opened.
   - Show: PR URL, branch name, what files were changed.

5. Show the SRE a summary: "The agent diagnosed [root cause], opened fix PR #[number] ([branch]), and created incident issue #[number]."

If the run fails, use `get_workflow_run_logs` or `list_jobs_for_workflow_run` to read the error and suggest what went wrong.
