import * as vscode from 'vscode';
import { GitHubClient } from '../github/githubClient';
import { SyncMapping } from '../config/schema';
import { PushableFile, PushResult } from './pushManager';

/**
 * Pushes changes to GitHub using the REST API (Trees + Blobs)
 * as a fallback when git is not available.
 */
export class RestPushFallback {
  constructor(
    private readonly githubClient: GitHubClient,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * Push changed files via the GitHub REST API.
   *
   * This creates blobs, a tree, a commit, and a new branch — all via REST.
   *
   * @param mapping - The sync mapping
   * @param files - Files to push
   * @returns The push result with branch name
   */
  async push(
    mapping: SyncMapping,
    files: PushableFile[],
  ): Promise<PushResult> {
    const [owner, repo] = mapping.repo.split('/');
    const baseBranch = mapping.branch || 'main';
    const pushBranch = `any-sync/${Date.now()}`;
    const normalizedSourcePath = mapping.sourcePath.replace(/^\/+|\/+$/g, '');

    this.outputChannel.appendLine(
      `Any Sync: Pushing ${files.length} files via REST API to ${owner}/${repo}...`,
    );

    // 1. Get the latest commit SHA on the base branch
    const latestCommitSha = await this.githubClient.getLatestCommitSha(
      owner,
      repo,
      baseBranch,
    );

    // 2. Create blobs for each file
    const treeEntries: Array<{
      path: string;
      mode: '100644' | '100755' | '040000' | '160000' | '120000';
      type: 'blob' | 'tree' | 'commit';
      sha: string;
    }> = [];

    for (const file of files) {
      const blobContent = file.content.toString('base64');
      const blobSha = await this.githubClient.createBlob(
        owner,
        repo,
        blobContent,
        'base64',
      );

      const filePath = normalizedSourcePath
        ? `${normalizedSourcePath}/${file.relativePath}`
        : file.relativePath;

      treeEntries.push({
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blobSha,
      });

      this.outputChannel.appendLine(`Any Sync: Created blob for ${filePath}`);
    }

    // 3. Create a new tree based on the latest commit's tree
    const newTreeSha = await this.githubClient.createTree(
      owner,
      repo,
      latestCommitSha,
      treeEntries,
    );

    // 4. Create a new commit
    const commitMessage = files.length === 1
      ? `sync: Update ${files[0].relativePath} via Any Sync`
      : `sync: Update ${files.length} files in ${mapping.sourcePath} via Any Sync`;

    const newCommitSha = await this.githubClient.createCommit(
      owner,
      repo,
      commitMessage,
      newTreeSha,
      [latestCommitSha],
    );

    // 5. Create the new branch
    await this.githubClient.createOrUpdateRef(
      owner,
      repo,
      pushBranch,
      newCommitSha,
    );

    this.outputChannel.appendLine(
      `Any Sync: Pushed ${files.length} files to branch ${pushBranch} via REST API`,
    );

    return {
      mapping,
      branch: pushBranch,
      files,
      usedGit: false,
    };
  }
}
