import * as vscode from 'vscode';
import { ConfigManager } from '../config/configManager';
import { AuthManager } from '../github/authManager';
import { GitHubClient } from '../github/githubClient';
import { PullManager, PullFileResult, PullResult } from './pullManager';
import { Lockfile } from './lockfile';
import { ConflictResolver } from '../conflict/conflictResolver';
import { ProgressReporter } from '../ui/progressReporter';
import { SyncMapping } from '../config/schema';

/**
 * Orchestrates pull and push sync operations.
 */
export class SyncEngine implements vscode.Disposable {
  private readonly pullManager: PullManager;
  private readonly lockfile: Lockfile;
  private readonly conflictResolver: ConflictResolver;
  private isSyncing = false;

  constructor(
    private readonly configManager: ConfigManager,
    private readonly authManager: AuthManager,
    private readonly githubClient: GitHubClient,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }

    this.lockfile = new Lockfile(workspaceRoot);
    this.pullManager = new PullManager(this.githubClient, this.lockfile, this.outputChannel);
    this.conflictResolver = new ConflictResolver();
  }

  /**
   * Pull all mappings.
   */
  async pullAll(): Promise<void> {
    const mappings = this.configManager.mappings;
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        'GitHub Sync: No mappings configured. Run "GitHub Sync: Init Config" to set up.',
      );
      return;
    }
    await this.pullMappings(mappings);
  }

  /**
   * Pull selected mappings.
   */
  async pullMappings(mappings: SyncMapping[]): Promise<void> {
    if (this.isSyncing) {
      vscode.window.showWarningMessage('GitHub Sync: A sync operation is already in progress.');
      return;
    }

    this.isSyncing = true;

    try {
      // Ensure auth
      const token = await this.authManager.requireToken();
      if (!token) {
        return;
      }

      // Load lockfile
      await this.lockfile.load();

      await ProgressReporter.withProgress(
        'GitHub Sync: Pulling...',
        async (progress, cancellationToken) => {
          const allResults: PullResult[] = [];

          for (let i = 0; i < mappings.length; i++) {
            if (cancellationToken.isCancellationRequested) {
              break;
            }

            const mapping = mappings[i];
            progress.report({
              message: `[${i + 1}/${mappings.length}] ${mapping.name}`,
              increment: 0,
            });

            const destRoot = this.configManager.resolveDestPath(mapping);
            const result = await this.pullManager.pull(mapping, destRoot, progress);

            // Handle conflicts
            const conflicts = result.files.filter((f) => f.status === 'conflict');
            if (conflicts.length > 0) {
              const resolutions = await this.conflictResolver.resolveConflicts(
                mapping,
                conflicts,
                destRoot,
              );

              // Apply resolutions
              for (const resolution of resolutions) {
                if (resolution.resolution === 'skip') {
                  continue;
                }
                if (resolution.content) {
                  const conflictFile = conflicts.find(
                    (c) => c.relativePath === resolution.relativePath,
                  );
                  if (conflictFile) {
                    await this.pullManager.resolveConflict(
                      mapping,
                      resolution.relativePath,
                      destRoot,
                      conflictFile.remoteSha,
                      resolution.content,
                    );
                  }
                }
              }
            }

            allResults.push(result);
          }

          // Show summary
          this.showPullSummary(allResults);
        },
      );
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Show a summary notification after pull.
   */
  private showPullSummary(results: PullResult[]): void {
    let newCount = 0;
    let updatedCount = 0;
    let conflictCount = 0;
    let errorCount = 0;

    for (const result of results) {
      for (const file of result.files) {
        switch (file.status) {
          case 'new':
            newCount++;
            break;
          case 'updated':
            updatedCount++;
            break;
          case 'conflict':
            conflictCount++;
            break;
          case 'error':
            errorCount++;
            break;
        }
      }
      errorCount += result.errors.length;
    }

    const parts: string[] = [];
    if (newCount > 0) {parts.push(`${newCount} new`);}
    if (updatedCount > 0) {parts.push(`${updatedCount} updated`);}
    if (conflictCount > 0) {parts.push(`${conflictCount} conflicts`);}
    if (errorCount > 0) {parts.push(`${errorCount} errors`);}

    if (parts.length === 0) {
      vscode.window.showInformationMessage('GitHub Sync: Everything up to date.');
    } else if (errorCount > 0) {
      vscode.window.showWarningMessage(`GitHub Sync: Pull completed with issues: ${parts.join(', ')}`);
    } else {
      vscode.window.showInformationMessage(`GitHub Sync: Pull complete — ${parts.join(', ')}`);
    }

    this.outputChannel.appendLine(`GitHub Sync: Pull summary — ${parts.join(', ') || 'no changes'}`);
  }

  /**
   * Get the lockfile instance (for push operations).
   */
  getLockfile(): Lockfile {
    return this.lockfile;
  }

  /**
   * Check if a sync is currently in progress.
   */
  get syncing(): boolean {
    return this.isSyncing;
  }

  dispose(): void {
    this.conflictResolver.dispose();
  }
}
