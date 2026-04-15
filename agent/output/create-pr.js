export async function createFixPR(github, { remediation, incidentId, isInfraIncident }) {
  // Escalation incidents have no files or branch — skip PR creation
  if (!remediation.branch_name || !remediation.files?.length) {
    return null;
  }

  const { sha: baseSHA } = await github.getDefaultBranchSHA();

  const prUrl = await github.createBranchWithFilesAndPR({
    branchName: remediation.branch_name,
    baseSHA,
    files:      remediation.files,
    prTitle:    remediation.pr_title,
    prBody:     remediation.pr_body,
  });

  // Label the PR so the repair workflow can identify agent-generated PRs
  const prNumber = parseInt(prUrl.split('/').pop());
  const labels = ['aiops-generated'];
  if (isInfraIncident) {
    labels.push('infrastructure');
  }
  await github.addLabels(prNumber, labels);

  return prUrl;
}
