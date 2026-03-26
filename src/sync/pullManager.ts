import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { minimatch } from 'minimatch';
import { SyncMapping } from '../config/schema';
import { GitHubClient, TreeEntry } from '../github/githubClient';
import { Lockfile, hashContent } from './lockfile';

/**
 * Status of a file during pull.
 */
export type PullFileStatus = 'new' | 'updated' | 'unchanged' | 'conflict' | 'error';

/**
 * A file to be pulled, with its status and content.
 */
export interface PullFileResult {
  relativePath: string;
  status: PullFileStatus;
  remoteSha: string;
  remoteContent?: Buffer;
  localContent?: Buffer;
  error?: string;
}

/**
 * Result of a pull operation for a single mapping.
 */
export interface PullResult {
  mapping: SyncMapping;
  files: PullFileResult[];
  errors: string[];
}

/**
 * Manages pulling files from GitHub to local directories.
 */
export class PullManager {
  constructor(
    private readonly githubClient: GitHubClient,
    private readonly lockfile: Lockfile,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * Pull files for a single mapping.
   *
   * @param mapping - The sync mapping to pull
   * @param destRoot - The resolved absolute destination path
   * @param progress - Optional progress reporter
   * @returns PullResult with file statuses
   */
  async pull(
    mapping: SyncMapping,
    destRoot: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<PullResult> {
    const errors: string[] = [];
    const files: PullFileResult[] = [];

    const [owner, repo] = mapping.repo.split('/');

    try {
      // Step 1: Determine branch
      progress?.report({ message: `Fetching tree for ${mapping.name}...` });
      const branch = mapping.branch || (await this.githubClient.getDefaultBranch(owner, repo));

      // Step 2: Get tree (directory listing)
      this.outputChannel.appendLine(
        `Any Sync: Fetching tree for ${owner}/${repo}/${branch}:${mapping.sourcePath}`,
      );
      const tree = await this.githubClient.getTree(owner, repo, branch, mapping.sourcePath);

      // Step 3: Filter to blobs only (files, not directories)
      const blobEntries = tree.filter((entry) => entry.type === 'blob');

      // Step 4: Apply include/exclude glob filters
      const filteredEntries = this.filterEntries(blobEntries, mapping.include, mapping.exclude);

      this.outputChannel.appendLine(
        `Any Sync: Found ${filteredEntries.length} files (${blobEntries.length} total, after filtering)`,
      );

      if (filteredEntries.length === 0) {
        return { mapping, files: [], errors: [] };
      }

      // Step 5: Determine which files need downloading
      const toDownload: TreeEntry[] = [];
      const unchanged: PullFileResult[] = [];

      for (const entry of filteredEntries) {
        const localFilePath = path.join(destRoot, entry.path);
        const remoteChanged = this.lockfile.isRemoteChanged(mapping.name, entry.path, entry.sha);
        const locallyModified = await this.lockfile.isLocallyModified(
          mapping.name,
          entry.path,
          localFilePath,
        );
        const hasLocalFile = await this.pathExists(localFilePath);
        const hasLockEntry = this.lockfile.getEntry(mapping.name, entry.path) !== null;

        if (!remoteChanged && !locallyModified) {
          unchanged.push({
            relativePath: entry.path,
            status: 'unchanged',
            remoteSha: entry.sha,
          });
        } else if (remoteChanged && (locallyModified || (hasLocalFile && !hasLockEntry))) {
          // Both changed — conflict, still need to download remote for diff
          toDownload.push(entry);
        } else if (remoteChanged) {
          // Only remote changed — safe to update
          toDownload.push(entry);
        } else {
          // Only local changed — no remote change, skip
          unchanged.push({
            relativePath: entry.path,
            status: 'unchanged',
            remoteSha: entry.sha,
          });
        }
      }

      files.push(...unchanged);

      // Step 6: Download changed files
      if (toDownload.length > 0) {
        progress?.report({ message: `Downloading ${toDownload.length} files...` });

        const blobMap = await this.githubClient.getBlobsBatched(
          owner,
          repo,
          toDownload.map((e) => ({ path: e.path, sha: e.sha })),
        );

        // Step 7: Process each downloaded file
        const increment = toDownload.length > 0 ? 80 / toDownload.length : 0;

        for (const entry of toDownload) {
          const remoteContent = blobMap.get(entry.path);
          if (!remoteContent) {
            files.push({
              relativePath: entry.path,
              status: 'error',
              remoteSha: entry.sha,
              error: 'Failed to download file content',
            });
            continue;
          }

          const localFilePath = path.join(destRoot, entry.path);
          const locallyModified = await this.lockfile.isLocallyModified(
            mapping.name,
            entry.path,
            localFilePath,
          );
          const hasLockEntry = this.lockfile.getEntry(mapping.name, entry.path) !== null;

          let localContent: Buffer | undefined;
          try {
            localContent = await fs.readFile(localFilePath);
          } catch {
            // File doesn't exist locally.
          }

          const isUntrackedLocalConflict =
            !hasLockEntry &&
            localContent !== undefined &&
            Buffer.compare(localContent, remoteContent) !== 0;

          if (locallyModified || isUntrackedLocalConflict) {
            // Conflict: both local and remote changed
            files.push({
              relativePath: entry.path,
              status: 'conflict',
              remoteSha: entry.sha,
              remoteContent,
              localContent,
            });
          } else {
            // Safe to write
            const existingEntry = this.lockfile.getEntry(mapping.name, entry.path);
            const isNew = !existingEntry;

            try {
              await this.atomicWrite(localFilePath, remoteContent);
              this.lockfile.setEntry(mapping.name, entry.path, entry.sha, remoteContent);
              files.push({
                relativePath: entry.path,
                status: isNew ? 'new' : 'updated',
                remoteSha: entry.sha,
              });
            } catch (err) {
              files.push({
                relativePath: entry.path,
                status: 'error',
                remoteSha: entry.sha,
                error: err instanceof Error ? err.message : String(err),
              });
              errors.push(
                `Failed to write ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          progress?.report({ increment, message: entry.path });
        }
      }

      // Update lockfile last sync time
      this.lockfile.setLastSync(mapping.name);
      await this.lockfile.save();

      return { mapping, files, errors };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(errMsg);
      this.outputChannel.appendLine(`Any Sync: Pull failed for ${mapping.name}: ${errMsg}`);
      return { mapping, files, errors };
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Filter tree entries by include/exclude glob patterns.
   */
  private filterEntries(
    entries: TreeEntry[],
    include?: string[],
    exclude?: string[],
  ): TreeEntry[] {
    let result = entries;

    if (include && include.length > 0) {
      result = result.filter((entry) =>
        include.some((pattern) => minimatch(entry.path, pattern, { dot: true })),
      );
    }

    if (exclude && exclude.length > 0) {
      result = result.filter(
        (entry) => !exclude.some((pattern) => minimatch(entry.path, pattern, { dot: true })),
      );
    }

    return result;
  }

  /**
   * Atomic write: write to temp file, then rename.
   * This prevents partial writes from corrupting files.
   */
  private async atomicWrite(filePath: string, content: Buffer): Promise<void> {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write to a temp file in the same directory (for atomic rename)
    const tempPath = path.join(
      dir,
      `.any-sync-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      await fs.writeFile(tempPath, content);
      await fs.rename(tempPath, filePath);
    } catch (err) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup error
      }
      throw err;
    }
  }

  /**
   * Resolve a file conflict by writing the chosen content.
   *
   * @param mapping - The sync mapping
   * @param relativePath - The file's relative path
   * @param destRoot - Absolute destination root
   * @param remoteSha - The remote file's SHA
   * @param content - The content to write (either local or remote)
   */
  async resolveConflict(
    mapping: SyncMapping,
    relativePath: string,
    destRoot: string,
    remoteSha: string,
    content: Buffer,
  ): Promise<void> {
    const localFilePath = path.join(destRoot, relativePath);
    await this.atomicWrite(localFilePath, content);
    this.lockfile.setEntry(mapping.name, relativePath, remoteSha, content);
    await this.lockfile.save();
  }
}
