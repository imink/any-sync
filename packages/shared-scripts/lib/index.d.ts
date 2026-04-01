export declare class Lockfile {
  static load(filePath: string): Lockfile;
  save(): void;
  getEntry(key: string): { remoteSha: string; localHash: string; syncedAt: string } | null;
  setEntry(key: string, remoteSha: string, localHash: string): void;
  getEntriesForMapping(name: string): Record<string, { remoteSha: string; localHash: string; syncedAt: string }>;
  setLastSync(name: string): void;
  getLastSync(name: string): string | null;
}

export declare function makeKey(mapping: string, relpath: string): string;
export declare function hashFile(filePath: string): string;

export declare function ghApi(args: string[], opts?: { input?: string }): string;
export declare function ghApiRetry(args: string[], opts?: { maxAttempts?: number; input?: string }): string;
export declare function getAuthToken(): string | null;

export declare function globMatch(pattern: string, filePath: string): boolean;
export declare function matchesAny(patterns: string[], filePath: string): boolean;

export declare function loadConfig(configPath: string): { mappings: Array<Record<string, unknown>> };
export declare function findConfig(): string | null;
export declare function expandTilde(p: string): string;
export declare function parseMapping(m: Record<string, unknown>): {
  name: string;
  repo: string;
  branch: string;
  sourcePath: string;
  destPath: string;
  include: string[];
  exclude: string[];
};

export declare function checkAuth(): string;

export declare function pull(configPath: string, lockfilePath: string): {
  pulled: string[];
  conflicts: string[];
  skipped: number;
};

export declare function push(configPath: string, lockfilePath: string): {
  pushed: string[];
  branch: string;
};

export declare function status(configPath: string, lockfilePath: string): {
  auth: { method: string; user: string | null };
  config: { path: string; valid: boolean };
  mappings: Array<{
    name: string;
    repo: string;
    branch: string;
    lastSync: string | null;
    tracked: number;
    changes: Array<{ file: string; type: string }>;
  }>;
};

export declare function reset(configPath: string, lockfilePath: string): {
  deletedConfig: boolean;
  configPath: string;
  deletedLockfile: boolean;
  lockfilePath: string;
};

export declare function init(
  configPath: string,
  repo: string,
  branch: string,
  mappings: Array<{
    name: string;
    sourcePath: string;
    destPath: string;
    include?: string[];
    exclude?: string[];
  }>,
): string;
