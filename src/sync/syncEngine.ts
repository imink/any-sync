import * as vscode from 'vscode';
import { ConfigManager, CONFIG_FILENAME } from '../config/configManager';
import { AuthManager } from '../github/authManager';
import { GitHubClient } from '../github/githubClient';
import { PullManager, PullFileResult, PullResult } from './pullManager';
import { PushManager, PushableFile } from './pushManager';
import { PrCreator } from './prCreator';
import { RestPushFallback } from './restPushFallback';
import { Lockfile } from './lockfile';
import { ConflictResolver } from '../conflict/conflictResolver';
import { ProgressReporter } from '../ui/progressReporter';
import { SyncMapping, validateConfig } from '../config/schema';
import { minimatch } from 'minimatch';

/**
 * Orchestrates pull and push sync operations.
 */
export class SyncEngine implements vscode.Disposable {
  private readonly pullManager: PullManager;
  private readonly pushManager: PushManager;
  private readonly prCreator: PrCreator;
  private readonly restPushFallback: RestPushFallback;
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
    this.pushManager = new PushManager(this.lockfile, this.outputChannel);
    this.prCreator = new PrCreator(this.githubClient, this.outputChannel);
    this.restPushFallback = new RestPushFallback(this.githubClient, this.outputChannel);
    this.conflictResolver = new ConflictResolver();
  }

  /**
   * Pull all mappings.
   */
  async pullAll(): Promise<void> {
    const mappings = this.configManager.mappings;
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        'Any Sync: No mappings configured. Run "Any Sync: Init or Edit Config" to set up.',
      );
      return;
    }
    await this.pullMappings(mappings, true);
  }

  /**
   * Pull selected mappings.
   */
  async pullMappings(mappings: SyncMapping[], refreshMappingsFromConfig = false): Promise<void> {
    if (this.isSyncing) {
      vscode.window.showWarningMessage('Any Sync: A sync operation is already in progress.');
      return;
    }

    this.isSyncing = true;

    try {
      // Ensure auth
      const token = await this.authManager.requireToken();
      if (!token) {
        return;
      }

      const didApplyRemoteConfig = await this.applyRemoteConfigAsDefault(mappings);
      const mappingsToPull = refreshMappingsFromConfig && didApplyRemoteConfig && this.configManager.mappings.length > 0
        ? this.configManager.mappings
        : mappings;

      // Load lockfile
      await this.lockfile.load();

      await ProgressReporter.withProgress(
        'Any Sync: Pulling...',
        async (progress, cancellationToken) => {
          const allResults: PullResult[] = [];

          for (let i = 0; i < mappingsToPull.length; i++) {
            if (cancellationToken.isCancellationRequested) {
              break;
            }

            const mapping = mappingsToPull[i];
            progress.report({
              message: `[${i + 1}/${mappingsToPull.length}] ${mapping.name}`,
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
   * Push all mappings.
   */
  async pushAll(): Promise<void> {
    const mappings = this.configManager.mappings;
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        'Any Sync: No mappings configured. Run "Any Sync: Init or Edit Config" to set up.',
      );
      return;
    }
    await this.pushMappings(mappings);
  }

  /**
   * Push selected mappings.
   */
  async pushMappings(mappings: SyncMapping[]): Promise<void> {
    if (this.isSyncing) {
      vscode.window.showWarningMessage('Any Sync: A sync operation is already in progress.');
      return;
    }

    this.isSyncing = true;

    try {
      const token = await this.authManager.requireToken();
      if (!token) {
        return;
      }

      await this.lockfile.load();

      await ProgressReporter.withProgress(
        'Any Sync: Pushing...',
        async (progress, cancellationToken) => {
          for (let i = 0; i < mappings.length; i++) {
            if (cancellationToken.isCancellationRequested) {
              break;
            }

            const mapping = mappings[i];
            progress.report({
              message: `[${i + 1}/${mappings.length}] Detecting changes for ${mapping.name}...`,
            });

            const destRoot = this.configManager.resolveDestPath(mapping);
            const mappingChanges = await this.pushManager.detectChanges(mapping, destRoot);
            const configChange = await this.buildConfigPushFile(mapping);
            const changes = configChange
              ? [...mappingChanges, configChange]
              : mappingChanges;

            if (changes.length === 0) {
              vscode.window.showInformationMessage(
                `Any Sync: No local changes to push for "${mapping.name}".`,
              );
              continue;
            }

            // Show confirmation dialog
            const fileList = changes.map((f) => f.repoPath ?? f.relativePath).join(', ');
            const confirm = await vscode.window.showWarningMessage(
              `Any Sync: Push ${changes.length} changed file(s) for "${mapping.name}"?\n\nFiles: ${fileList}`,
              { modal: true },
              'Push & Create PR',
              'Cancel',
            );

            if (confirm !== 'Push & Create PR') {
              continue;
            }

            progress.report({ message: `Pushing ${changes.length} files...` });

            // Try git first, fall back to REST API
            let pushResult;
            const gitAvailable = await this.pushManager.isGitAvailable();

            if (gitAvailable) {
              const commitMessage = changes.length === 1
                ? `sync: Update ${changes[0].relativePath} via Any Sync`
                : `sync: Update ${changes.length} files in ${mapping.sourcePath} via Any Sync`;

              pushResult = await this.pushManager.pushViaGit(
                mapping,
                changes,
                token,
                commitMessage,
              );
            } else {
              pushResult = await this.restPushFallback.push(mapping, changes);
            }

            // Create PR
            progress.report({ message: 'Creating pull request...' });
            await this.prCreator.createPr(mapping, pushResult.branch, changes);
          }
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
      vscode.window.showInformationMessage('Any Sync: Everything up to date.');
    } else if (errorCount > 0) {
      vscode.window.showWarningMessage(`Any Sync: Pull completed with issues: ${parts.join(', ')}`);
    } else {
      vscode.window.showInformationMessage(`Any Sync: Pull complete — ${parts.join(', ')}`);
    }

    this.outputChannel.appendLine(`Any Sync: Pull summary — ${parts.join(', ') || 'no changes'}`);
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

  private async buildConfigPushFile(mapping: SyncMapping): Promise<PushableFile | null> {
    if (!this.shouldPushPathForMapping(mapping, CONFIG_FILENAME)) {
      return null;
    }

    const localConfig = await this.configManager.readConfigFileRaw();
    if (!localConfig) {
      return null;
    }

    const [owner, repo] = mapping.repo.split('/');
    const branch = mapping.branch || (await this.githubClient.getDefaultBranch(owner, repo));
    const remoteConfig = await this.githubClient.getFileContent(
      owner,
      repo,
      CONFIG_FILENAME,
      branch,
    );

    if (remoteConfig && Buffer.compare(localConfig, remoteConfig) === 0) {
      return null;
    }

    return {
      relativePath: CONFIG_FILENAME,
      repoPath: CONFIG_FILENAME,
      localPath: CONFIG_FILENAME,
      content: localConfig,
    };
  }

  private shouldPushPathForMapping(mapping: SyncMapping, filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const includes = mapping.include;
    const excludes = mapping.exclude;

    if (includes && includes.length > 0) {
      const included = includes.some((pattern) =>
        minimatch(normalizedPath, pattern, { dot: true }),
      );
      if (!included) {
        return false;
      }
    }

    if (excludes && excludes.length > 0) {
      const excluded = excludes.some((pattern) =>
        minimatch(normalizedPath, pattern, { dot: true }),
      );
      if (excluded) {
        return false;
      }
    }

    return true;
  }

  private async applyRemoteConfigAsDefault(mappings: SyncMapping[]): Promise<boolean> {
    const localConfig = await this.configManager.readConfigFileRaw();

    for (const mapping of mappings) {
      const [owner, repo] = mapping.repo.split('/');
      const branch = mapping.branch || (await this.githubClient.getDefaultBranch(owner, repo));

      const remoteConfig = await this.githubClient.getFileContent(
        owner,
        repo,
        CONFIG_FILENAME,
        branch,
      );

      if (!remoteConfig) {
        continue;
      }

      try {
        const parsed = JSON.parse(remoteConfig.toString('utf8'));
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }

        if (validateConfig(parsed).length > 0) {
          this.outputChannel.appendLine(
            `Any Sync: Skipping remote ${CONFIG_FILENAME} from ${owner}/${repo} because it failed schema validation`,
          );
          continue;
        }
      } catch {
        this.outputChannel.appendLine(
          `Any Sync: Skipping remote ${CONFIG_FILENAME} from ${owner}/${repo} because it is invalid JSON`,
        );
        continue;
      }

      if (!localConfig || Buffer.compare(localConfig, remoteConfig) !== 0) {
        await this.configManager.writeConfigFileRaw(remoteConfig);
        this.outputChannel.appendLine(
          `Any Sync: Updated local ${CONFIG_FILENAME} from ${owner}/${repo}@${branch}`,
        );
        return true;
      }

      return false;
    }

    return false;
  }
}
