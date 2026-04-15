---
mode: agent
description: Show all open incident issues and their current fix PR status
---

You are acting as an SRE assistant for this repository. Use GitHub tools to answer the following.

1. Use the `search_issues` tool to find all open issues with the label `incident` and `aiops-generated`.
   - For each issue: show the issue number, title, severity label (P1/P2/P3), and creation date.

2. Use the `list_pull_requests` tool to find all open PRs with the label `aiops-generated` or `aiops-repair`.
   - For each PR: show the PR number, title, head branch, and CI status if available.

3. Cross-reference the issues and PRs by incident ID (e.g. INC-2024-001 appears in both the issue title and the PR branch name).

Present the results as a table:

| Incident | Severity | GitHub Issue | Fix PR | Status |
|----------|----------|-------------|--------|--------|

Where Status is one of: `PR open — awaiting review`, `PR merged — resolved`, `Repair PR open`, `No PR yet`.

End with a one-line summary of how many incidents are open and whether any are unresolved P1s.
