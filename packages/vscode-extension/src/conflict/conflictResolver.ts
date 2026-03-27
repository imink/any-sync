import * as vscode from 'vscode';
import * as path from 'path';
import { SyncMapping } from '../config/schema';
import { PullFileResult } from '../sync/pullManager';
import { RemoteContentProvider } from './remoteContentProvider';

/**
 * User's resolution choice for a conflict.
 */
export type ConflictResolution = 'keepLocal' | 'takeRemote' | 'skip';

/**
 * Result of resolving a single conflict.
 */
export interface ConflictResolutionResult {
  relativePath: string;
  resolution: ConflictResolution;
  /** The content to write (local or remote), or undefined if skipped. */
  content?: Buffer;
}

/**
 * Manages conflict detection and resolution via VSCode UI.
 */
export class ConflictResolver implements vscode.Disposable {
  private readonly remoteContentProvider: RemoteContentProvider;
  private readonly providerRegistration: vscode.Disposable;

  constructor() {
    this.remoteContentProvider = new RemoteContentProvider();
    this.providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
      'any-sync-remote',
      this.remoteContentProvider,
    );
  }

  /**
   * Resolve all conflicts for a set of pull results.
   * Shows a QuickPick for each conflict file, one at a time.
   *
   * @param mapping - The sync mapping
   * @param conflicts - Array of PullFileResults with status 'conflict'
   * @param destRoot - Absolute destination root path
   * @returns Array of resolution results
   */
  async resolveConflicts(
    mapping: SyncMapping,
    conflicts: PullFileResult[],
    destRoot: string,
  ): Promise<ConflictResolutionResult[]> {
    const results: ConflictResolutionResult[] = [];

    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      const result = await this.resolveOne(mapping, conflict, destRoot, i + 1, conflicts.length);
      results.push(result);
    }

    // Clean up remote content after all conflicts resolved
    this.remoteContentProvider.clear();

    return results;
  }

  /**
   * Resolve a single file conflict.
   */
  private async resolveOne(
    mapping: SyncMapping,
    conflict: PullFileResult,
    destRoot: string,
    index: number,
    total: number,
  ): Promise<ConflictResolutionResult> {
    const localFilePath = path.join(destRoot, conflict.relativePath);

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(arrow-left) Keep Local',
        description: 'Keep your local changes, ignore the remote version',
        detail: 'The remote version will be skipped for this file',
      },
      {
        label: '$(arrow-right) Take Remote',
        description: 'Overwrite local with the remote version',
        detail: 'Your local changes will be lost',
      },
      {
        label: '$(diff) Open Side-by-Side Diff',
        description: 'Compare local and remote versions, then decide',
        detail: 'Opens a diff editor so you can review the changes',
      },
      {
        label: '$(close) Skip',
        description: 'Skip this file for now',
        detail: 'No changes will be made to this file',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `Conflict (${index}/${total}): ${conflict.relativePath}`,
      placeHolder: `Both local and remote versions of ${conflict.relativePath} have changed. How would you like to resolve this?`,
      ignoreFocusOut: true,
    });

    if (!picked) {
      // User dismissed — skip
      return { relativePath: conflict.relativePath, resolution: 'skip' };
    }

    if (picked.label.includes('Keep Local')) {
      return {
        relativePath: conflict.relativePath,
        resolution: 'keepLocal',
        content: conflict.localContent,
      };
    }

    if (picked.label.includes('Take Remote')) {
      return {
        relativePath: conflict.relativePath,
        resolution: 'takeRemote',
        content: conflict.remoteContent,
      };
    }

    if (picked.label.includes('Diff')) {
      // Open diff editor, then ask again
      return await this.showDiffAndResolve(
        mapping,
        conflict,
        localFilePath,
        destRoot,
        index,
        total,
      );
    }

    // Skip
    return { relativePath: conflict.relativePath, resolution: 'skip' };
  }

  /**
   * Show a side-by-side diff editor, then ask user to resolve.
   */
  private async showDiffAndResolve(
    mapping: SyncMapping,
    conflict: PullFileResult,
    localFilePath: string,
    _destRoot: string,
    index: number,
    total: number,
  ): Promise<ConflictResolutionResult> {
    // Set up remote content for the diff view
    const remoteUri = RemoteContentProvider.buildUri(mapping.name, conflict.relativePath);
    const remoteText = conflict.remoteContent?.toString('utf8') ?? '';
    this.remoteContentProvider.setContent(remoteUri, remoteText);

    // Open diff editor: remote (left) vs local (right)
    const localUri = vscode.Uri.file(localFilePath);
    const title = `${conflict.relativePath} (Remote ↔ Local)`;

    await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, title);

    // Now ask user to decide
    const items: vscode.QuickPickItem[] = [
      {
        label: '$(arrow-left) Keep Local',
        description: 'Keep your local changes',
      },
      {
        label: '$(arrow-right) Take Remote',
        description: 'Overwrite with remote version',
      },
      {
        label: '$(close) Skip',
        description: 'Skip this file for now',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: `Resolve conflict (${index}/${total}): ${conflict.relativePath}`,
      placeHolder: 'Review the diff, then choose how to resolve',
      ignoreFocusOut: true,
    });

    // Clean up the remote content for this file
    this.remoteContentProvider.removeContent(remoteUri);

    if (!picked || picked.label.includes('Skip')) {
      return { relativePath: conflict.relativePath, resolution: 'skip' };
    }

    if (picked.label.includes('Keep Local')) {
      return {
        relativePath: conflict.relativePath,
        resolution: 'keepLocal',
        content: conflict.localContent,
      };
    }

    return {
      relativePath: conflict.relativePath,
      resolution: 'takeRemote',
      content: conflict.remoteContent,
    };
  }

  dispose(): void {
    this.providerRegistration.dispose();
    this.remoteContentProvider.dispose();
  }
}
