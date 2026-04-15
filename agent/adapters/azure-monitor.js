/**
 * Azure Monitor Common Alert Schema → SRE Agent alert.json adapter
 *
 * Azure Monitor fires webhooks using the Common Alert Schema:
 * https://docs.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-common-schema
 *
 * This adapter normalizes that payload into the format the agent's
 * diagnostic pipeline expects, so the same LLM pipeline works for
 * both SAP BTP / native alerts and Azure Monitor alerts.
 *
 * Usage:
 *   const alert = normalizeAzureAlert(azurePayload, overrides);
 */

/**
 * Map Azure Monitor severity labels to P-levels
 * Sev0 = critical, Sev1 = error, Sev2 = warning, Sev3 = informational, Sev4 = verbose
 */
const SEVERITY_MAP = {
  Sev0: 'P1',
  Sev1: 'P1',
  Sev2: 'P2',
  Sev3: 'P3',
  Sev4: 'P3',
};

/**
 * Derive a short service name from an Azure resource ID.
 * e.g. ".../providers/Microsoft.Web/sites/my-service" → "my-service"
 */
function serviceFromResourceId(resourceId = '') {
  const parts = resourceId.split('/');
  return parts[parts.length - 1] || 'unknown-service';
}

/**
 * Normalize an Azure Monitor Common Alert Schema payload into the agent's alert format.
 *
 * @param {object} azurePayload  - The full Azure Monitor webhook body
 * @param {object} overrides     - Optional overrides: blame_pr_number, blame_pr_title, incident_id
 * @returns {object}             - alert.json compatible object
 */
export function normalizeAzureAlert(azurePayload, overrides = {}) {
  const ess = azurePayload?.data?.essentials ?? {};
  const ctx = azurePayload?.data?.alertContext ?? {};

  const resourceId   = (ess.alertTargetIDs || [])[0] || '';
  const serviceName  = serviceFromResourceId(resourceId);
  const severity     = SEVERITY_MAP[ess.severity] ?? 'P2';
  const firedAt      = ess.firedDateTime ?? new Date().toISOString();
  const alertRule    = ess.alertRule ?? 'UnknownAlertRule';
  const alertId      = ess.alertId ?? `azure-${Date.now()}`;

  // Build metrics from the alertContext condition criteria
  const metrics = {};
  const conditions = ctx?.condition?.allOf ?? [];
  for (const c of conditions) {
    const key = (c.metricName || c.searchQuery || 'metric')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    metrics[key] = c.metricValue ?? c.threshold ?? 0;
    if (c.threshold !== undefined) {
      metrics[`${key}_threshold`] = c.threshold;
    }
  }

  return {
    incident_id:         overrides.incident_id   ?? `INC-AZ-${Date.now()}`,
    scenario:            overrides.scenario       ?? 'azure-monitor',
    title:               `${alertRule}: ${ess.monitorCondition ?? 'Fired'} on ${serviceName}`,
    severity,
    service:             serviceName,
    environment:         ess.resourceEnvironment ?? 'production',
    timestamp:           firedAt,
    alert_source:        `Azure Monitor (${ess.monitoringService ?? 'Platform'})`,
    metrics,
    labels: {
      azure_resource_id:    resourceId,
      azure_resource_group: ess.resourceGroupName ?? '',
      azure_subscription:   ess.subscriptionId    ?? '',
      azure_alert_rule:     alertRule,
      azure_alert_id:       alertId,
      signal_type:          ess.signalType         ?? 'Metric',
    },
    // These must be provided via overrides or will trigger a PR-less diagnosis
    blame_pr_number:      overrides.blame_pr_number ?? null,
    blame_pr_title:       overrides.blame_pr_title  ?? `(unknown — blame PR not set by Azure Monitor; check recent ${serviceName} deployments)`,
    blame_commit_sha:     overrides.blame_commit_sha ?? null,
    blame_commit_message: overrides.blame_commit_message ?? null,
  };
}
