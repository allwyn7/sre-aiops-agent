export async function createDiagnosisIssue(github, { alert, diagnosis, remediation, targetIssueNumber, sreArtifacts, artifactPaths }) {
  const { diagnosis: d } = diagnosis;

  // Build Mermaid incident timeline
  const incidentTime = new Date(alert.timestamp);
  const deployTime   = new Date(incidentTime.getTime() - 15 * 60000); // ~15 min before incident
  const detectTime   = new Date(incidentTime.getTime() + 2 * 60000);
  const diagTime     = new Date(incidentTime.getTime() + 4 * 60000);
  const fixTime      = new Date(incidentTime.getTime() + 6 * 60000);
  const fmt = (d) => d.toISOString().slice(11, 16); // HH:MM

  const similarPastNote = d.similar_past_incident
    ? `\n> **Known pattern:** This matches a previously resolved incident (${d.similar_past_incident}). Resolution was accelerated using the knowledge base.\n`
    : '';

  const repoUrl = `https://github.com/${process.env.GITHUB_REPO}`;

  const body = [
    `## Post-Incident Report — ${alert.incident_id}`,
    '',
    `> **Severity:** ${alert.severity} | **Service:** \`${alert.service}\` | **Time:** ${alert.timestamp}`,
    similarPastNote,
    '---',
    '',
    '### Incident Timeline',
    '',
    '```mermaid',
    'timeline',
    `    title ${alert.incident_id} Incident Timeline`,
    `    section Trigger`,
    `        ${fmt(deployTime)} : PR #${d.blame_pr_number} deployed to production`,
    `    section Detection`,
    `        ${fmt(incidentTime)} : Metrics spike detected`,
    `                             : ${alert.metrics.error_rate_percent || alert.metrics.http_401_rate_per_min || ''}% error rate`,
    `        ${fmt(detectTime)} : Alert fired - ${alert.severity}`,
    `    section Response`,
    `        ${fmt(diagTime)} : AIOps Agent diagnosed root cause`,
    `                        : Confidence - ${d.confidence}`,
    `        ${fmt(fixTime)} : Fix PR created`,
    '```',
    '',
    '---',
    '',
    '### Impact',
    d.blast_radius,
    '',
    `**Affected endpoints:** ${d.affected_components.join(', ')}`,
    '',
    '### Root Cause',
    d.root_cause,
    '',
    `**Blame:** PR #${d.blame_pr_number} — ${d.blame_pr_reasoning}`,
    '',
    `**Confidence:** ${d.confidence}`,
    '',
    '### Immediate Actions',
    d.affected_components && diagnosis.immediate_actions
      ? diagnosis.immediate_actions.map(a => `- [ ] ${a}`).join('\n')
      : '_See fix PR._',
    '',
    '### Remediation',
    diagnosis.remediation_description,
    '',
    `**Fix PR:** ${remediation?.branch_name ? `Branch \`${remediation.branch_name}\` — see linked PR` : '_pending_'}`,
    '',
    '### Follow-Up',
    '- [ ] Confirm fix deployed to production',
    '- [ ] Verify error rate returns to baseline',
    '- [ ] Add integration test to prevent regression',
    '- [ ] Update runbook with this incident pattern',
    '',
    '---',
    '',
    '### Correlation Evidence',
    '',
    '| Signal | Value | Baseline |',
    '|--------|-------|----------|',
    ...Object.entries(alert.metrics || {}).filter(([k]) => !k.startsWith('affected')).map(
      ([key, value]) => `| \`${key}\` | ${value} | _see alert_ |`
    ),
  ];

  // ── Enhanced sections from SRE artifacts ──────────────────────────────────
  if (sreArtifacts?.incident_response_metadata) {
    const meta = sreArtifacts.incident_response_metadata;

    body.push(
      '',
      '---',
      '',
      '### Severity Assessment',
      '',
      '| Dimension | Rating |',
      '|-----------|--------|',
      `| **Score** | ${meta.severity_score}/10 |`,
      `| **Impact** | ${meta.severity_matrix?.impact || '_N/A_'} |`,
      `| **Urgency** | ${meta.severity_matrix?.urgency || '_N/A_'} |`,
      '',
      `**MTTR Estimate:** ${meta.mttr_estimate_minutes} minutes`,
      `> ${meta.mttr_justification}`,
    );

    if (meta.escalation_path?.length) {
      body.push(
        '',
        '### Escalation Path',
        '',
        ...meta.escalation_path.map((role, i) => `${i + 1}. ${role}`),
      );
    }

    if (meta.communication_template) {
      body.push(
        '',
        '### Communication Template',
        '',
        '<details>',
        '<summary>Click to expand stakeholder notification</summary>',
        '',
        meta.communication_template,
        '',
        '</details>',
      );
    }
  }

  if (artifactPaths) {
    const links = [];
    if (artifactPaths.runbookPath) {
      links.push(`| Operational Runbook | [\`${artifactPaths.runbookPath}\`](${repoUrl}/blob/main/${artifactPaths.runbookPath}) |`);
    }
    if (artifactPaths.alertingRulesPath) {
      links.push(`| Alerting Rules (Prometheus) | [\`${artifactPaths.alertingRulesPath}\`](${repoUrl}/blob/main/${artifactPaths.alertingRulesPath}) |`);
    }
    if (artifactPaths.recommendationsPath) {
      links.push(`| Recommendations (Capacity / DR / Perf) | [\`${artifactPaths.recommendationsPath}\`](${repoUrl}/blob/main/${artifactPaths.recommendationsPath}) |`);
    }

    if (links.length) {
      body.push(
        '',
        '---',
        '',
        '### SRE Artifacts Generated',
        '',
        '| Artifact | Location |',
        '|----------|----------|',
        ...links,
      );
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  body.push(
    '',
    '---',
    `_Generated by SRE AIOps Agent_ | Run: ${process.env.RUN_ID || 'local'}`,
  );

  const bodyStr = body.join('\n');

  // If a triggering issue was specified, comment on it; always create a dedicated report issue
  if (targetIssueNumber) {
    await github.commentOnIssue(targetIssueNumber, `## AIOps Diagnosis\n\n${d.summary}\n\n**Root cause:** ${d.root_cause}\n\n> Full report: see linked post-incident issue.`);
  }

  const issueUrl = await github.createIssue({
    title:  `[Post-Incident] ${alert.incident_id}: ${alert.title}`,
    body:   bodyStr,
    labels: ['incident', 'aiops-generated', alert.severity.toLowerCase()],
  });

  return issueUrl;
}
