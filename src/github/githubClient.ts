import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { AuthManager } from './authManager';

/**
 * Result of a rate limit check.
 */
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
}

/**
 * A tree entry from the GitHub Trees API.
 */
export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/**
 * Wraps Octokit with auth integration, rate limiting, and pagination.
 */
export class GitHubClient implements vscode.Disposable {
  private _octokit: Octokit | null = null;
  private _rateLimitInfo: RateLimitInfo | null = null;
  private _authSubscription: vscode.Disposable;

  constructor(
    private readonly authManager: AuthManager,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    // Reinitialize Octokit when auth changes
    this._authSubscription = this.authManager.onDidChangeToken(() => {
      this._octokit = null; // Force re-creation on next use
    });
  }

  /**
   * Get an authenticated Octokit instance.
   * Creates a new instance if needed (first call or after auth change).
   */
  private async getOctokit(): Promise<Octokit> {
    if (this._octokit) {
      return this._octokit;
    }

    const token = await this.authManager.requireToken();
    if (!token) {
      throw new Error('GitHub authentication required');
    }

    this._octokit = new Octokit({
      auth: token,
      userAgent: 'github-sync-vscode',
      log: {
        debug: (msg: string) => this.outputChannel.appendLine(`[Octokit DEBUG] ${msg}`),
        info: (msg: string) => this.outputChannel.appendLine(`[Octokit INFO] ${msg}`),
        warn: (msg: string) => this.outputChannel.appendLine(`[Octokit WARN] ${msg}`),
        error: (msg: string) => this.outputChannel.appendLine(`[Octokit ERROR] ${msg}`),
      },
    });

    return this._octokit;
  }

  /**
   * Update rate limit info from response headers.
   */
  private updateRateLimit(headers: Record<string, string | number | undefined>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    const limit = Number(headers['x-ratelimit-limit']);
    const reset = Number(headers['x-ratelimit-reset']);

    if (!isNaN(remaining) && !isNaN(limit) && !isNaN(reset)) {
      this._rateLimitInfo = {
        remaining,
        limit,
        resetAt: new Date(reset * 1000),
      };

      if (remaining < 100) {
        this.outputChannel.appendLine(
          `GitHub Sync: Rate limit warning - ${remaining}/${limit} remaining, resets at ${this._rateLimitInfo.resetAt.toLocaleTimeString()}`,
        );
      }

      if (remaining < 10) {
        vscode.window.showWarningMessage(
          `GitHub Sync: API rate limit nearly exhausted (${remaining} remaining). Resets at ${this._rateLimitInfo.resetAt.toLocaleTimeString()}.`,
        );
      }
    }
  }

  /**
   * Get the current rate limit info, or null if no requests have been made.
   */
  get rateLimit(): RateLimitInfo | null {
    return this._rateLimitInfo;
  }

  /**
   * Get the default branch for a repository.
   */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const octokit = await this.getOctokit();
    const response = await octokit.repos.get({ owner, repo });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return response.data.default_branch;
  }

  /**
   * Get a git tree (directory listing) for a specific path in a repo.
   * Uses recursive tree fetching and filters to the specified path.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param branch - Branch or commit SHA
   * @param sourcePath - Path within repo to list (e.g., "skills/")
   * @returns Array of tree entries under sourcePath
   */
  async getTree(
    owner: string,
    repo: string,
    branch: string,
    sourcePath: string,
  ): Promise<TreeEntry[]> {
    const octokit = await this.getOctokit();

    // Get the tree SHA for the branch
    const refResponse = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    this.updateRateLimit(refResponse.headers as Record<string, string | number | undefined>);

    const commitSha = refResponse.data.object.sha;

    // Get the commit to find the tree SHA
    const commitResponse = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });
    this.updateRateLimit(commitResponse.headers as Record<string, string | number | undefined>);

    const treeSha = commitResponse.data.tree.sha;

    // Get the full recursive tree
    const treeResponse = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true',
    });
    this.updateRateLimit(treeResponse.headers as Record<string, string | number | undefined>);

    if (treeResponse.data.truncated) {
      this.outputChannel.appendLine(
        'GitHub Sync: Warning - tree response was truncated. Very large repositories may have incomplete listings.',
      );
    }

    // Normalize sourcePath: remove leading/trailing slashes
    const normalizedPath = sourcePath.replace(/^\/+|\/+$/g, '');
    const prefix = normalizedPath ? normalizedPath + '/' : '';

    // Filter entries to those under sourcePath and make paths relative
    return (treeResponse.data.tree as TreeEntry[])
      .filter((entry) => {
        if (!prefix) {
          return true;
        } // Root: include everything
        return entry.path.startsWith(prefix);
      })
      .map((entry) => ({
        ...entry,
        path: prefix ? entry.path.slice(prefix.length) : entry.path,
      }))
      .filter((entry) => entry.path.length > 0); // Remove the directory itself
  }

  /**
   * Get the content of a blob (file) by its SHA.
   * Returns the decoded content as a Buffer.
   */
  async getBlob(owner: string, repo: string, sha: string): Promise<Buffer> {
    const octokit = await this.getOctokit();
    const response = await octokit.git.getBlob({
      owner,
      repo,
      file_sha: sha,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);

    // Blobs are returned as base64-encoded content
    return Buffer.from(response.data.content, 'base64');
  }

  /**
   * Get multiple blobs in parallel, with concurrency control.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param shas - Array of { path, sha } objects
   * @param concurrency - Max concurrent requests (default: 15)
   * @returns Map of path -> Buffer content
   */
  async getBlobsBatched(
    owner: string,
    repo: string,
    shas: Array<{ path: string; sha: string }>,
    concurrency: number = 15,
  ): Promise<Map<string, Buffer>> {
    const results = new Map<string, Buffer>();
    const queue = [...shas];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) {
          break;
        }

        try {
          const content = await this.getBlob(owner, repo, item.sha);
          results.set(item.path, content);
        } catch (err) {
          this.outputChannel.appendLine(
            `GitHub Sync: Failed to download ${item.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      }
    };

    // Launch concurrent workers
    const workers = Array.from({ length: Math.min(concurrency, shas.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }

  /**
   * Get the latest commit SHA for a branch.
   */
  async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    const octokit = await this.getOctokit();
    const response = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return response.data.object.sha;
  }

  /**
   * Create a new tree from entries.
   */
  async createTree(
    owner: string,
    repo: string,
    baseTreeSha: string,
    entries: Array<{
      path: string;
      mode: '100644' | '100755' | '040000' | '160000' | '120000';
      type: 'blob' | 'tree' | 'commit';
      sha?: string;
      content?: string;
    }>,
  ): Promise<string> {
    const octokit = await this.getOctokit();
    const response = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: entries,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return response.data.sha;
  }

  /**
   * Create a new commit.
   */
  async createCommit(
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parentShas: string[],
  ): Promise<string> {
    const octokit = await this.getOctokit();
    const response = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeSha,
      parents: parentShas,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return response.data.sha;
  }

  /**
   * Create or update a branch reference.
   */
  async createOrUpdateRef(
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
  ): Promise<void> {
    const octokit = await this.getOctokit();
    const ref = `refs/heads/${branch}`;

    try {
      // Try to update existing ref
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commitSha,
      });
    } catch {
      // Ref doesn't exist, create it
      await octokit.git.createRef({
        owner,
        repo,
        ref,
        sha: commitSha,
      });
    }
  }

  /**
   * Create a pull request.
   */
  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<{ number: number; html_url: string }> {
    const octokit = await this.getOctokit();
    const response = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return {
      number: response.data.number,
      html_url: response.data.html_url,
    };
  }

  /**
   * Create a blob in a repo.
   */
  async createBlob(
    owner: string,
    repo: string,
    content: string,
    encoding: 'utf-8' | 'base64' = 'utf-8',
  ): Promise<string> {
    const octokit = await this.getOctokit();
    const response = await octokit.git.createBlob({
      owner,
      repo,
      content,
      encoding,
    });
    this.updateRateLimit(response.headers as Record<string, string | number | undefined>);
    return response.data.sha;
  }

  dispose(): void {
    this._authSubscription.dispose();
    this._octokit = null;
  }
}
