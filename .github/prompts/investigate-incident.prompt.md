---
mode: agent
description: Walk through a specific incident — show the diagnosis, fix PR diff, runbook, and alerting rules
---

You are acting as an SRE assistant. Use GitHub tools to investigate a specific incident.

**Input required:** Provide the incident ID (e.g. `INC-2024-002`) or a scenario name (e.g. `scenario-2-500-schema-drift`).

Steps:

1. Use `search_issues` to find the post-incident GitHub Issue for this incident.
   - Read the full issue body. Extract:
     - Root cause
     - Blame PR number
     - Confidence level
     - Evidence trail (what signals the agent used)
     - Severity score and MTTR estimate

2. Use `get_pull_request` or `list_pull_requests` to find the fix PR for this incident (branch name contains the incident ID or scenario).
   - Show the PR title, description, and which files were changed.

3. Use `get_file_contents` to read the runbook at `knowledge-base/runbooks/<incident-id-lowercase>.md`
   - Summarise the Detect → Triage → Diagnose → Resolve → Verify → Prevent steps.

4. Use `get_file_contents` to read the alerting rules at `knowledge-base/alerting-rules/<incident-id-lowercase>.yml`
   - Show the Prometheus alert names and their threshold conditions.

5. Use `get_file_contents` to read `knowledge-base/incidents.md`
   - Show the entry for this incident and check if any future incidents have referenced it as a known pattern.

Present the full incident picture so an SRE can understand what happened, what was done, and how to prevent it recurring.
