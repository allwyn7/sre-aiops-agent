// agent/tool-executor.js
// Maps LLM tool_call names to actual Node.js function invocations.
// The existing output modules are called here unchanged — this is the adapter layer.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDiagnosisIssue } from './output/create-issue.js';
import { createFixPR } from './output/create-pr.js';
import { appendToKnowledgeBase } from './output/knowledge-base.js';
import { commitSREArtifacts } from './output/commit-sre-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ToolExecutor {
  constructor(github, scenarioDir, targetIssueNumber) {
    this.github = github;
    this.scenarioDir = scenarioDir;
    this.targetIssueNumber = targetIssueNumber || null;
  }

  async execute(toolName, args) {
    switch (toolName) {
      case 'get_incident_alert':    return this._getIncidentAlert();
      case 'get_incident_logs':     return this._getIncidentLogs();
      case 'get_recent_prs':        return this._getRecentPRs(args);
      case 'get_pr_diff':           return this._getPRDiff(args);
      case 'get_file_content':      return this._getFileContent(args);
      case 'get_knowledge_base':    return this._getKnowledgeBase();
      case 'get_flyway_version':    return this._getFlywayVersion();
      case 'create_fix_pr':         return this._createFixPR(args);
      case 'commit_sre_artifact':   return this._commitSREArtifact(args);
      case 'create_github_issue':   return this._createGitHubIssue(args);
      case 'update_knowledge_base': return this._updateKnowledgeBase(args);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ── Investigation tools ───────────────────────────────────────────────────

  _getIncidentAlert() {
    const raw = fs.readFileSync(path.join(this.scenarioDir, 'alert.json'), 'utf8');
    return JSON.parse(raw);
  }

  _getIncidentLogs() {
    const logs = fs.readFileSync(path.join(this.scenarioDir, 'logs.txt'), 'utf8');
    // Keep within GitHub Models context limits
    return logs.length > 3000 ? logs.slice(0, 3000) + '\n...(truncated)' : logs;
  }

  async _getRecentPRs({ count = 10 } = {}) {
    return this.github.getRecentPRs(count);
  }

  async _getPRDiff({ pr_number }) {
    return this.github.getPRDiff(pr_number);
  }

  async _getFileContent({ file_path }) {
    const result = await this.github.getFileContent(file_path);
    if (!result) return `(File not found: ${file_path})`;
    return result.content;
  }

  async _getKnowledgeBase() {
    const result = await this.github.getFileContent('knowledge-base/incidents.md');
    const content = result?.content ?? '(Knowledge base is empty — no prior incidents recorded)';
    // Keep within GitHub Models context limits
    return content.length > 2000 ? content.slice(0, 2000) + '\n...(truncated)' : content;
  }

  async _getFlywayVersion() {
    const highest = await this.github.getHighestFlywayVersion();
    return { highest_version: highest, next_version: highest + 1 };
  }

  // ── Action tools ─────────────────────────────────────────────────────────

  async _createFixPR(args) {
    const prUrl = await createFixPR(this.github, {
      remediation: {
        branch_name: args.branch_name,
        pr_title:    args.pr_title,
        pr_body:     args.pr_body,
        files:       args.files,
      },
      incidentId: null, // not used by createFixPR
    });
    return { pr_url: prUrl };
  }

  async _commitSREArtifact(args) {
    // Build the minimal alert shape commitSREArtifacts expects
    const alert = {
      incident_id: args.incident_id,
      title:       args.incident_id, // used in alert header if present
      service:     args.service,
      severity:    args.severity,
      timestamp:   args.timestamp,
    };

    // Build a partial sreArtifacts object with only the relevant key populated.
    // commitSREArtifacts already guards with `if (rb)`, `if (alertingYaml)`, `if (cp || dr || pt)`
    // so passing only one key commits only that artifact.
    let sreArtifacts = {};

    if (args.artifact_type === 'runbook') {
      sreArtifacts.runbook = {
        title:            args.runbook_title            || `${args.incident_id} Runbook`,
        incident_pattern: args.runbook_incident_pattern || '',
        detection:        args.runbook_detection        || '',
        triage:           args.runbook_triage           || '',
        diagnosis:        args.runbook_diagnosis        || '',
        resolution:       args.runbook_resolution       || '',
        verification:     args.runbook_verification     || '',
        prevention:       args.runbook_prevention       || '',
      };
    } else if (args.artifact_type === 'alerting_rules') {
      sreArtifacts.alerting_rules_yaml = args.alerting_rules_yaml || '';
    } else if (args.artifact_type === 'recommendations') {
      if (args.capacity_current_utilization || args.capacity_scaling_thresholds) {
        sreArtifacts.capacity_planning = {
          current_utilization:      args.capacity_current_utilization      || '',
          scaling_thresholds:       args.capacity_scaling_thresholds       || '',
          resource_recommendations: args.capacity_resource_recommendations  || '',
          growth_projections:       args.capacity_growth_projections        || '',
          cost_considerations:      args.capacity_cost_considerations       || '',
        };
      }
      if (args.dr_ha_recommendations) {
        sreArtifacts.disaster_recovery = {
          spof_identified:      args.dr_spof_identified      || [],
          ha_recommendations:   args.dr_ha_recommendations   || '',
          failover_strategy:    args.dr_failover_strategy    || '',
          rto_rpo_assessment:   args.dr_rto_rpo_assessment   || '',
          backup_recommendations: args.dr_backup_recommendations || '',
        };
      }
      if (args.perf_jvm_tuning) {
        sreArtifacts.performance_tuning = {
          jvm_tuning:             args.perf_jvm_tuning             || '',
          spring_boot_tuning:     args.perf_spring_boot_tuning     || '',
          jpa_hibernate_tuning:   args.perf_jpa_hibernate_tuning   || '',
          database_tuning:        args.perf_database_tuning        || '',
          connection_pool_tuning: args.perf_connection_pool_tuning || '',
        };
      }
    }

    const paths = await commitSREArtifacts(this.github, {
      alert,
      sreArtifacts,
      issueUrl: args.issue_url || '',
      prUrl:    args.pr_url    || '',
    });

    // Return the specific path for this artifact type so the agent can use it in create_github_issue
    const idLower = args.incident_id.toLowerCase().replace(/_/g, '-');
    const pathMap = {
      runbook:         { path: `knowledge-base/runbooks/${idLower}.md`,         key: 'runbook_path' },
      alerting_rules:  { path: `knowledge-base/alerting-rules/${idLower}.yml`,  key: 'alerting_rules_path' },
      recommendations: { path: `knowledge-base/recommendations/${idLower}.md`,  key: 'recommendations_path' },
    };
    const entry = pathMap[args.artifact_type];
    return { success: true, [entry.key]: entry.path };
  }

  async _createGitHubIssue(args) {
    // Reassemble the shape that createDiagnosisIssue() expects
    const alert = {
      incident_id: args.incident_id,
      title:       args.incident_title,
      severity:    args.severity,
      service:     args.service,
      timestamp:   args.timestamp,
      metrics:     args.metrics || {},
    };

    const diagnosis = {
      diagnosis: {
        summary:               args.diagnosis_summary,
        root_cause:            args.root_cause,
        affected_components:   args.affected_components   || [],
        blast_radius:          args.blast_radius,
        confidence:            args.confidence,
        blame_pr_number:       args.blame_pr_number,
        blame_pr_reasoning:    args.blame_pr_reasoning,
        similar_past_incident: args.similar_past_incident || null,
      },
      immediate_actions:       args.immediate_actions      || [],
      remediation_description: args.remediation_description,
    };

    const remediation = args.branch_name ? { branch_name: args.branch_name } : null;

    // Synthesize minimal sreArtifacts shape if severity metadata was provided
    const sreArtifacts = (args.severity_score || args.mttr_estimate_minutes)
      ? {
          incident_response_metadata: {
            severity_score:        args.severity_score,
            mttr_estimate_minutes: args.mttr_estimate_minutes,
            severity_matrix:       {},
            escalation_path:       [],
          },
        }
      : null;

    const hasArtifactPaths = args.runbook_path || args.alerting_rules_path || args.recommendations_path;
    const artifactPaths = hasArtifactPaths
      ? {
          runbookPath:         args.runbook_path         || null,
          alertingRulesPath:   args.alerting_rules_path  || null,
          recommendationsPath: args.recommendations_path || null,
        }
      : null;

    const issueUrl = await createDiagnosisIssue(this.github, {
      alert,
      diagnosis,
      remediation,
      targetIssueNumber: this.targetIssueNumber || args.target_issue_number || null,
      sreArtifacts,
      artifactPaths,
    });

    return { issue_url: issueUrl };
  }

  async _updateKnowledgeBase(args) {
    const alert = {
      incident_id: args.incident_id,
      title:       args.incident_title,
      severity:    args.severity,
      service:     args.service,
      timestamp:   args.timestamp,
    };

    // appendToKnowledgeBase expects { diagnosis: { diagnosis: d, runbook_entry: rb } }
    const diagnosis = {
      diagnosis: {
        root_cause: args.root_cause,
      },
      runbook_entry: {
        pattern:    args.pattern,
        resolution: args.resolution,
      },
    };

    await appendToKnowledgeBase(this.github, {
      alert,
      diagnosis,
      prUrl:    args.pr_url,
      issueUrl: args.issue_url,
    });

    return { success: true, path: 'knowledge-base/incidents.md' };
  }
}
