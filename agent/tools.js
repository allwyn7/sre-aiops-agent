// agent/tools.js
// OpenAI function-calling tool schemas for the SRE AIOps agent.
// The agent (gpt-4o) decides which tools to call and in what order.

export const TOOLS = [

  // ── Investigation tools (read-only) ──────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'get_incident_alert',
      description: 'Returns the alert.json for the current incident. Call this first.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_incident_logs',
      description: 'Returns application logs from around the incident time.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_recent_prs',
      description: 'Fetches the most recently merged pull requests.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', description: 'Number of PRs to retrieve. Default 10.' },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_pr_diff',
      description: 'Fetches the unified diff for a pull request. Always call with the blame_pr_number before writing a fix.',
      parameters: {
        type: 'object',
        properties: {
          pr_number: { type: 'integer', description: 'PR number.' },
        },
        required: ['pr_number'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_file_content',
      description: 'Reads a file from the repo default branch.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Repo-relative path.' },
        },
        required: ['file_path'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_knowledge_base',
      description: 'Reads past resolved incidents for pattern matching.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_flyway_version',
      description: 'Returns the highest Flyway migration version. Call before flyway_migration fixes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Action tools — call in this order: create_fix_pr → commit_sre_artifact (×3)
  //                                        → create_github_issue → update_knowledge_base

  {
    type: 'function',
    function: {
      name: 'create_fix_pr',
      description: 'Creates a fix branch, commits files, and opens a PR. Returns pr_url — save it for subsequent calls.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: {
            type: 'string',
            description: 'Branch name for the fix, e.g. "fix/inc-2024-001-drop-price-old-column".',
          },
          pr_title: {
            type: 'string',
            description: 'Pull request title.',
          },
          pr_body: {
            type: 'string',
            description:
              'Pull request body in Markdown. Include: Problem, Root Cause, Fix description, and a testing checklist.',
          },
          files: {
            type: 'array',
            description: 'Files to commit. Each file must have complete content — no truncation.',
            items: {
              type: 'object',
              properties: {
                path:        { type: 'string', description: 'Repository-relative file path.' },
                content:     { type: 'string', description: 'Complete file content. No placeholders.' },
                description: { type: 'string', description: 'Short description for the commit message.' },
              },
              required: ['path', 'content', 'description'],
            },
          },
        },
        required: ['branch_name', 'pr_title', 'pr_body', 'files'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'commit_sre_artifact',
      description: 'Commits one SRE artifact to knowledge-base. Call 3x: artifact_type runbook, alerting_rules, recommendations. Call after create_fix_pr.',
      parameters: {
        type: 'object',
        properties: {
          artifact_type: {
            type: 'string',
            enum: ['runbook', 'alerting_rules', 'recommendations'],
            description: 'The type of artifact to commit.',
          },
          incident_id:   { type: 'string',  description: 'Incident ID, e.g. INC-2024-002.' },
          service:       { type: 'string',  description: 'Affected service name.' },
          severity:      { type: 'string',  description: 'Incident severity (P0–P3).' },
          timestamp:     { type: 'string',  description: 'ISO 8601 incident timestamp.' },
          issue_url:     { type: 'string',  description: 'GitHub issue URL (can be empty string before issue is created).' },
          pr_url:        { type: 'string',  description: 'Fix PR URL from create_fix_pr.' },

          // ── Runbook fields (required when artifact_type = 'runbook') ──────
          runbook_title:            { type: 'string', description: 'Runbook title.' },
          runbook_incident_pattern: { type: 'string', description: 'Log pattern or error signature that triggers this runbook.' },
          runbook_detection:        { type: 'string', description: 'How to detect this incident (alerts, dashboards, log queries).' },
          runbook_triage:           { type: 'string', description: 'Initial triage steps to assess scope and confirm impact.' },
          runbook_diagnosis:        { type: 'string', description: 'Diagnosis steps — commands, queries, what to look for.' },
          runbook_resolution:       { type: 'string', description: 'Resolution steps.' },
          runbook_verification:     { type: 'string', description: 'How to verify the fix worked.' },
          runbook_prevention:       { type: 'string', description: 'Preventive measures and follow-up tasks.' },

          // ── Alerting rules fields (required when artifact_type = 'alerting_rules') ──
          alerting_rules_yaml: {
            type: 'string',
            description: 'Complete Prometheus/Alertmanager YAML content for alerting rules.',
          },

          // ── Recommendations fields (required when artifact_type = 'recommendations') ──
          capacity_current_utilization:      { type: 'string' },
          capacity_scaling_thresholds:       { type: 'string' },
          capacity_resource_recommendations: { type: 'string' },
          capacity_growth_projections:       { type: 'string' },
          capacity_cost_considerations:      { type: 'string' },
          dr_spof_identified:      { type: 'array',  items: { type: 'string' } },
          dr_ha_recommendations:   { type: 'string' },
          dr_failover_strategy:    { type: 'string' },
          dr_rto_rpo_assessment:   { type: 'string' },
          dr_backup_recommendations: { type: 'string' },
          perf_jvm_tuning:             { type: 'string' },
          perf_spring_boot_tuning:     { type: 'string' },
          perf_jpa_hibernate_tuning:   { type: 'string' },
          perf_database_tuning:        { type: 'string' },
          perf_connection_pool_tuning: { type: 'string' },
        },
        required: ['artifact_type', 'incident_id', 'service', 'severity', 'timestamp'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'create_github_issue',
      description: 'Creates a post-incident GitHub issue with timeline, root cause, and artifact links. Call after create_fix_pr and commit_sre_artifact.',
      parameters: {
        type: 'object',
        properties: {
          incident_id:    { type: 'string',  description: 'Incident ID, e.g. INC-2024-002.' },
          incident_title: { type: 'string',  description: 'Short incident title.' },
          severity:       { type: 'string',  description: 'P0, P1, P2, or P3.' },
          service:        { type: 'string',  description: 'Affected service name.' },
          timestamp:      { type: 'string',  description: 'ISO 8601 incident timestamp.' },
          metrics: {
            type: 'object',
            description: 'Key metrics from the alert (error_rate_percent, response_time_ms, etc.).',
          },
          blame_pr_number:    { type: 'integer', description: 'PR number of the blamed change.' },
          root_cause:         { type: 'string',  description: 'Technical description of the root cause.' },
          diagnosis_summary:  { type: 'string',  description: 'One-sentence diagnosis summary.' },
          confidence:         { type: 'string',  description: 'Diagnosis confidence: high, medium, or low.' },
          blast_radius:       { type: 'string',  description: 'Description of the impact scope.' },
          affected_components: {
            type: 'array',
            items: { type: 'string' },
            description: 'Affected endpoints or components.',
          },
          blame_pr_reasoning:    { type: 'string',  description: 'Why this PR caused the incident.' },
          similar_past_incident: { type: 'string',  description: 'ID of a similar past incident from the KB, or null.' },
          immediate_actions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Checklist of immediate response actions.',
          },
          remediation_description: { type: 'string', description: 'Description of the remediation approach.' },
          branch_name:             { type: 'string',  description: 'Fix PR branch name from create_fix_pr.' },
          severity_score:          { type: 'integer', description: 'Numeric severity score 1–10.' },
          mttr_estimate_minutes:   { type: 'integer', description: 'Estimated MTTR in minutes.' },
          runbook_path:            { type: 'string',  description: 'Repo path to the runbook file.' },
          alerting_rules_path:     { type: 'string',  description: 'Repo path to alerting rules file.' },
          recommendations_path:    { type: 'string',  description: 'Repo path to recommendations file.' },
          target_issue_number:     { type: 'integer', description: 'If set, also post a comment on this existing issue.' },
        },
        required: [
          'incident_id', 'incident_title', 'severity', 'service', 'timestamp',
          'blame_pr_number', 'root_cause', 'diagnosis_summary', 'confidence',
          'blast_radius', 'affected_components', 'blame_pr_reasoning',
          'immediate_actions', 'remediation_description',
        ],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'update_knowledge_base',
      description: 'Appends incident entry to knowledge-base/incidents.md. Call last — needs both pr_url and issue_url.',
      parameters: {
        type: 'object',
        properties: {
          incident_id:     { type: 'string', description: 'Incident ID.' },
          incident_title:  { type: 'string', description: 'Incident title.' },
          severity:        { type: 'string', description: 'P0, P1, P2, or P3.' },
          service:         { type: 'string', description: 'Affected service name.' },
          timestamp:       { type: 'string', description: 'ISO 8601 incident timestamp.' },
          pattern:         { type: 'string', description: 'Error pattern or log signature (regex/exact string) for future matching.' },
          root_cause:      { type: 'string', description: 'Technical root cause description.' },
          resolution:      { type: 'string', description: 'How the incident was resolved.' },
          issue_url:       { type: 'string', description: 'GitHub issue URL from create_github_issue.' },
          pr_url:          { type: 'string', description: 'Fix PR URL from create_fix_pr.' },
        },
        required: [
          'incident_id', 'incident_title', 'severity', 'service', 'timestamp',
          'pattern', 'root_cause', 'resolution', 'issue_url', 'pr_url',
        ],
      },
    },
  },
];
