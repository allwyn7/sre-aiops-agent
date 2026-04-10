import { Octokit } from '@octokit/rest';

export class GitHubClient {
  constructor(owner, repo) {
    this.owner = owner;
    this.repo  = repo;
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }

  // Fetch the N most recently merged PRs with their metadata
  async getRecentPRs(count = 10) {
    const { data } = await this.octokit.pulls.list({
      owner: this.owner,
      repo:  this.repo,
      state: 'closed',
      sort:  'updated',
      direction: 'desc',
      per_page: count,
    });

    return data
      .filter(pr => pr.merged_at)
      .map(pr => ({
        number:    pr.number,
        title:     pr.title,
        author:    pr.user.login,
        merged_at: pr.merged_at,
        url:       pr.html_url,
        body:      (pr.body || '').slice(0, 300),
      }));
  }

  // Fetch the unified diff for a single PR
  async getPRDiff(prNumber) {
    try {
      const { data } = await this.octokit.pulls.get({
        owner:        this.owner,
        repo:         this.repo,
        pull_number:  prNumber,
        mediaType:    { format: 'diff' },
      });
      // Truncate large diffs to keep prompt size manageable
      const diff = String(data);
      return diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff;
    } catch (err) {
      console.log(`   Warning: could not fetch diff for PR #${prNumber} (${err.status || err.message}). Using alert metadata for diagnosis.`);
      return `(PR #${prNumber} diff unavailable — using alert metadata and logs for diagnosis)`;
    }
  }

  // Find the highest Flyway migration version already in main
  async getHighestFlywayVersion() {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo:  this.repo,
        path:  'app/src/main/resources/db/migration',
      });
      const versions = data
        .map(f => f.name.match(/^V(\d+)__/))
        .filter(Boolean)
        .map(m => parseInt(m[1]));
      return versions.length ? Math.max(...versions) : 1;
    } catch {
      return 1; // directory doesn't exist yet
    }
  }

  // Create a GitHub Issue and return its URL
  async createIssue({ title, body, labels }) {
    const { data } = await this.octokit.issues.create({
      owner: this.owner,
      repo:  this.repo,
      title,
      body,
      labels: labels || [],
    });
    return data.html_url;
  }

  // Post a comment on an existing issue
  async commentOnIssue(issueNumber, body) {
    const { data } = await this.octokit.issues.createComment({
      owner:        this.owner,
      repo:         this.repo,
      issue_number: issueNumber,
      body,
    });
    return data.html_url;
  }

  // Get the SHA of the HEAD of the default branch
  async getDefaultBranchSHA() {
    const { data: repo } = await this.octokit.repos.get({
      owner: this.owner,
      repo:  this.repo,
    });
    const branch = repo.default_branch;
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo:  this.repo,
      ref:   `heads/${branch}`,
    });
    return { sha: ref.object.sha, defaultBranch: branch };
  }

  // Create a branch, commit files to it, and open a PR
  async createBranchWithFilesAndPR({ branchName, baseSHA, files, prTitle, prBody }) {
    const { defaultBranch } = await this.getDefaultBranchSHA();

    // Create branch
    await this.octokit.git.createRef({
      owner: this.owner,
      repo:  this.repo,
      ref:   `refs/heads/${branchName}`,
      sha:   baseSHA,
    });

    // Commit each file
    for (const file of files) {
      let existingSHA;
      try {
        const { data } = await this.octokit.repos.getContent({
          owner: this.owner,
          repo:  this.repo,
          path:  file.path,
          ref:   branchName,
        });
        existingSHA = data.sha;
      } catch { /* file doesn't exist yet */ }

      await this.octokit.repos.createOrUpdateFileContents({
        owner:   this.owner,
        repo:    this.repo,
        path:    file.path,
        message: `fix: ${file.description}`,
        content: Buffer.from(file.content).toString('base64'),
        branch:  branchName,
        ...(existingSHA ? { sha: existingSHA } : {}),
      });
    }

    // Open PR
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo:  this.repo,
      title: prTitle,
      body:  prBody,
      head:  branchName,
      base:  defaultBranch,
      draft: false,
    });
    return pr.html_url;
  }

  // Read a file from the default branch
  async getFileContent(filePath) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo:  this.repo,
        path:  filePath,
      });
      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        sha:     data.sha,
      };
    } catch {
      return null;
    }
  }

  // Update a file on the default branch (for knowledge-base append)
  async updateFile({ path: filePath, content, message }) {
    const existing = await this.getFileContent(filePath);
    await this.octokit.repos.createOrUpdateFileContents({
      owner:   this.owner,
      repo:    this.repo,
      path:    filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      ...(existing ? { sha: existing.sha } : {}),
    });
  }
}
