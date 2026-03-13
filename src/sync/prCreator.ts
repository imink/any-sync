import * as vscode from 'vscode';
import { GitHubClient } from '../github/githubClient';
import { SyncMapping } from '../config/schema';
import { PushableFile } from './pushManager';

/**
 * Result of PR creation.
 */
export interface PrResult {
  number: number;
  url: string;
  title: string;
}

/**
 * Creates pull requests on GitHub after pushing changes.
 */
export class PrCreator {
  constructor(
    private readonly githubClient: GitHubClient,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * Create a PR for pushed changes.
   *
   * @param mapping - The sync mapping
   * @param pushBranch - The branch name that was pushed
   * @param files - The files that were changed
   * @returns PR result with number and URL
   */
  async createPr(
    mapping: SyncMapping,
    pushBranch: string,
    files: PushableFile[],
  ): Promise<PrResult> {
    const [owner, repo] = mapping.repo.split('/');
    const baseBranch = mapping.branch || 'main';

    const title = this.generateTitle(mapping, files);
    const body = this.generateBody(mapping, files);

    this.outputChannel.appendLine(
      `Any Sync: Creating PR on ${owner}/${repo}: "${title}" (${pushBranch} → ${baseBranch})`,
    );

    const result = await this.githubClient.createPullRequest(
      owner,
      repo,
      title,
      body,
      pushBranch,
      baseBranch,
    );

    this.outputChannel.appendLine(
      `Any Sync: PR #${result.number} created: ${result.html_url}`,
    );

    // Show notification with clickable link
    const action = await vscode.window.showInformationMessage(
      `Any Sync: PR #${result.number} created on ${owner}/${repo}`,
      'Open PR',
    );

    if (action === 'Open PR') {
      vscode.env.openExternal(vscode.Uri.parse(result.html_url));
    }

    return {
      number: result.number,
      url: result.html_url,
      title,
    };
  }

  /**
   * Generate a PR title based on the mapping and changed files.
   */
  private generateTitle(mapping: SyncMapping, files: PushableFile[]): string {
    if (files.length === 1) {
      return `sync: Update ${files[0].relativePath} via Any Sync`;
    }
    return `sync: Update ${files.length} files in ${mapping.sourcePath} via Any Sync`;
  }

  /**
   * Generate a PR body with a list of changed files.
   */
  generateBody(mapping: SyncMapping, files: PushableFile[]): string {
    const lines: string[] = [
      '## Any Sync — Automated PR',
      '',
      `**Mapping:** ${mapping.name}`,
      `**Source path:** \`${mapping.sourcePath}\``,
      `**Files changed:** ${files.length}`,
      '',
      '### Changed files',
      '',
    ];

    for (const file of files) {
      lines.push(`- \`${file.relativePath}\``);
    }

    lines.push('');
    lines.push('---');
    lines.push(
      '*This PR was created automatically by the [Any Sync](https://marketplace.visualstudio.com/items?itemName=any-sync) VSCode extension.*',
    );

    return lines.join('\n');
  }
}
