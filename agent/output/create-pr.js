export async function createFixPR(github, { remediation, incidentId }) {
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
  await github.addLabels(prNumber, ['aiops-generated']);

  return prUrl;
}
