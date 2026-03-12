import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

const LOCKFILE_NAME = '.github-sync.lock';

/**
 * A lockfile entry representing a previously-synced file.
 */
export interface LockfileEntry {
  /** SHA of the file from the remote (GitHub blob SHA) */
  remoteSha: string;
  /** SHA256 hash of the local file content at last sync */
  localHash: string;
  /** Timestamp of last sync */
  syncedAt: string;
}

/**
 * The full lockfile structure.
 */
export interface LockfileData {
  version: 1;
  /** Key: "mappingName::relativePath" */
  files: Record<string, LockfileEntry>;
  /** Last sync timestamp per mapping */
  lastSync: Record<string, string>;
}

/**
 * Compute SHA256 hash of a Buffer.
 */
export function hashContent(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Manages the .github-sync.lock file for tracking sync state.
 */
export class Lockfile {
  private data: LockfileData;

  constructor(private readonly workspaceRoot: string) {
    this.data = { version: 1, files: {}, lastSync: {} };
  }

  /**
   * Get the lockfile path.
   */
  get filePath(): string {
    return path.join(this.workspaceRoot, LOCKFILE_NAME);
  }

  /**
   * Build a key for the files map.
   */
  private fileKey(mappingName: string, relativePath: string): string {
    return `${mappingName}::${relativePath}`;
  }

  /**
   * Load the lockfile from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.version === 1 && typeof parsed.files === 'object') {
        this.data = parsed as LockfileData;
      }
    } catch {
      // File doesn't exist or invalid — start fresh
      this.data = { version: 1, files: {}, lastSync: {} };
    }
  }

  /**
   * Save the lockfile to disk.
   */
  async save(): Promise<void> {
    const content = JSON.stringify(this.data, null, 2) + '\n';
    await fs.writeFile(this.filePath, content, 'utf8');
  }

  /**
   * Get the stored entry for a file, or null if not previously synced.
   */
  getEntry(mappingName: string, relativePath: string): LockfileEntry | null {
    return this.data.files[this.fileKey(mappingName, relativePath)] ?? null;
  }

  /**
   * Update or create an entry for a file.
   */
  setEntry(
    mappingName: string,
    relativePath: string,
    remoteSha: string,
    localContent: Buffer,
  ): void {
    const key = this.fileKey(mappingName, relativePath);
    this.data.files[key] = {
      remoteSha,
      localHash: hashContent(localContent),
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Remove an entry for a file.
   */
  removeEntry(mappingName: string, relativePath: string): void {
    delete this.data.files[this.fileKey(mappingName, relativePath)];
  }

  /**
   * Get all entries for a specific mapping.
   */
  getEntriesForMapping(mappingName: string): Map<string, LockfileEntry> {
    const prefix = `${mappingName}::`;
    const result = new Map<string, LockfileEntry>();
    for (const [key, entry] of Object.entries(this.data.files)) {
      if (key.startsWith(prefix)) {
        result.set(key.slice(prefix.length), entry);
      }
    }
    return result;
  }

  /**
   * Update the last sync timestamp for a mapping.
   */
  setLastSync(mappingName: string): void {
    this.data.lastSync[mappingName] = new Date().toISOString();
  }

  /**
   * Get the last sync timestamp for a mapping.
   */
  getLastSync(mappingName: string): Date | null {
    const ts = this.data.lastSync[mappingName];
    return ts ? new Date(ts) : null;
  }

  /**
   * Check if a local file has been modified since last sync.
   * Compares the current file content hash with the stored hash.
   */
  async isLocallyModified(
    mappingName: string,
    relativePath: string,
    localFilePath: string,
  ): Promise<boolean> {
    const entry = this.getEntry(mappingName, relativePath);
    if (!entry) {
      return false; // Never synced, so not "modified"
    }

    try {
      const content = await fs.readFile(localFilePath);
      const currentHash = hashContent(content);
      return currentHash !== entry.localHash;
    } catch {
      return false; // File doesn't exist locally
    }
  }

  /**
   * Check if a remote file has changed since last sync.
   */
  isRemoteChanged(mappingName: string, relativePath: string, currentRemoteSha: string): boolean {
    const entry = this.getEntry(mappingName, relativePath);
    if (!entry) {
      return true; // Never synced, treat as changed
    }
    return entry.remoteSha !== currentRemoteSha;
  }
}
