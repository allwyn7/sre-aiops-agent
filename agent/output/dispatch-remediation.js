/**
 * Dispatches the infrastructure remediation GitHub Actions workflow.
 */
export async function dispatchRemediation(github, { incidentId, infraActionType, targetResources, prUrl }) {
  const result = await github.dispatchWorkflow('infra-remediation.yml', {
    incident_id:      incidentId,
    action_type:      infraActionType || 'scale_k8s',
    target_resources: JSON.stringify(targetResources || {}),
    fix_pr_url:       prUrl || '',
  });

  console.log(`   Dispatched infra-remediation.yml with action_type=${infraActionType}`);
  return result;
}
