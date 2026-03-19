import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { minimatch } from 'minimatch';
import { simpleGit, SimpleGit } from 'simple-git';
import { SyncMapping } from '../config/schema';
import { Lockfile, hashContent } from './lockfile';

/**
 * A file that has been locally modified and is ready to push.
 */
export interface PushableFile {
  /** Relative path within the mapping */
  relativePath: string;
  /** Absolute local file path */
  localPath: string;
  /** Current local content */
  content: Buffer;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  mapping: SyncMapping;
  /** Branch name that was pushed to */
  branch: string;
  /** Files that were pushed */
  files: PushableFile[];
  /** Whether git was available (vs. REST API fallback) */
  usedGit: boolean;
}

/**
 * Manages pushing local changes to GitHub via sparse git checkout.
 */
export class PushManager {
  constructor(
    private readonly lockfile: Lockfile,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /**
   * Check if system git is available.
   */
  async isGitAvailable(): Promise<boolean> {
    try {
      const git = simpleGit();
      const version = await git.version();
      this.outputChannel.appendLine(`Any Sync: Git available: ${version.installed ? version.major + '.' + version.minor + '.' + version.patch : 'not installed'}`);
      return version.installed;
    } catch {
      return false;
    }
  }

  /**
   * Detect locally modified files for a mapping by comparing with lockfile.
   *
   * @param mapping - The sync mapping
   * @param destRoot - Resolved absolute destination path
   * @returns Array of files that have been locally modified
   */
  async detectChanges(
    mapping: SyncMapping,
    destRoot: string,
  ): Promise<PushableFile[]> {
    const changes: PushableFile[] = [];
    const entries = this.lockfile.getEntriesForMapping(mapping.name);

    for (const [relativePath, entry] of entries) {
      const localPath = path.join(destRoot, relativePath);

      try {
        const content = await fs.readFile(localPath);
        const currentHash = hashContent(content);

        if (currentHash !== entry.localHash) {
          changes.push({ relativePath, localPath, content });
        }
      } catch {
        // File was deleted — could be treated as a deletion push
        // For now, skip deleted files
        this.outputChannel.appendLine(
          `Any Sync: Skipping deleted file: ${relativePath}`,
        );
      }
    }

    // Also check for new files in destRoot that aren't in the lockfile
    await this.findNewFiles(mapping, destRoot, entries, changes);

    // Apply include/exclude glob filters
    return this.filterFiles(changes, mapping.include, mapping.exclude);
  }

  /**
   * Filter pushable files by include/exclude glob patterns.
   */
  private filterFiles(
    files: PushableFile[],
    include?: string[],
    exclude?: string[],
  ): PushableFile[] {
    let result = files;

    if (include && include.length > 0) {
      result = result.filter((file) =>
        include.some((pattern) => minimatch(file.relativePath, pattern, { dot: true })),
      );
    }

    if (exclude && exclude.length > 0) {
      result = result.filter(
        (file) => !exclude.some((pattern) => minimatch(file.relativePath, pattern, { dot: true })),
      );
    }

    return result;
  }

  /**
   * Find files in destRoot that aren't tracked in the lockfile.
   */
  private async findNewFiles(
    mapping: SyncMapping,
    destRoot: string,
    existingEntries: Map<string, unknown>,
    changes: PushableFile[],
  ): Promise<void> {
    try {
      const allFiles = await this.walkDirectory(destRoot);

      for (const absolutePath of allFiles) {
        const relativePath = path.relative(destRoot, absolutePath);
        // Normalize to forward slashes for cross-platform compatibility
        const normalizedPath = relativePath.split(path.sep).join('/');

        if (!existingEntries.has(normalizedPath)) {
          // Skip hidden files and lockfiles
          if (normalizedPath.startsWith('.') || normalizedPath.includes('/.')) {
            continue;
          }

          try {
            const content = await fs.readFile(absolutePath);
            changes.push({
              relativePath: normalizedPath,
              localPath: absolutePath,
              content,
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
  }

  /**
   * Recursively walk a directory and return all file paths.
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await this.walkDirectory(fullPath)));
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }

    return results;
  }

  /**
   * Push changes via sparse git checkout.
   *
   * @param mapping - The sync mapping
   * @param files - Files to push
   * @param token - GitHub auth token
   * @param commitMessage - Commit message
   * @returns The branch name and pushed files
   */
  async pushViaGit(
    mapping: SyncMapping,
    files: PushableFile[],
    token: string,
    commitMessage: string,
  ): Promise<PushResult> {
    const [owner, repo] = mapping.repo.split('/');
    const branch = mapping.branch || 'main';
    const pushBranch = `any-sync/${Date.now()}`;
    const tmpDir = path.join(os.tmpdir(), `any-sync-push-${Date.now()}`);

    try {
      await fs.mkdir(tmpDir, { recursive: true });

      this.outputChannel.appendLine(`Any Sync: Cloning ${owner}/${repo} (sparse) to ${tmpDir}...`);

      // Sparse clone
      const git = simpleGit(tmpDir);
      const repoUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

      await git.clone(repoUrl, tmpDir, [
        '--depth=1',
        '--single-branch',
        `--branch=${branch}`,
        '--filter=blob:none',
        '--sparse',
      ]);

      // Re-initialize simple-git for the cloned repo
      const cloneGit = simpleGit(tmpDir);

      // Set sparse-checkout to include only the source path
      const normalizedSourcePath = mapping.sourcePath.replace(/^\/+|\/+$/g, '');
      await cloneGit.raw(['sparse-checkout', 'set', normalizedSourcePath]);

      // Copy changed files into the sparse checkout
      for (const file of files) {
        const destPath = path.join(tmpDir, normalizedSourcePath, file.relativePath);
        const destDir = path.dirname(destPath);
        await fs.mkdir(destDir, { recursive: true });
        await fs.writeFile(destPath, file.content);
      }

      // Create branch, stage, commit, push
      await cloneGit.checkoutLocalBranch(pushBranch);
      await cloneGit.add('.');
      await cloneGit.commit(commitMessage);
      await cloneGit.push('origin', pushBranch);

      this.outputChannel.appendLine(`Any Sync: Pushed ${files.length} files to branch ${pushBranch}`);

      return {
        mapping,
        branch: pushBranch,
        files,
        usedGit: true,
      };
    } finally {
      // Always clean up temp directory
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        this.outputChannel.appendLine('Any Sync: Cleaned up temp directory');
      } catch (cleanupErr) {
        this.outputChannel.appendLine(
          `Any Sync: Warning — failed to clean up temp dir: ${cleanupErr}`,
        );
      }
    }
  }
}
