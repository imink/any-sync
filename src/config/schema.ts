/**
 * TypeScript types and validation for .any-sync.json configuration.
 */

export interface SyncMapping {
  /** Human-readable name for this mapping */
  name: string;
  /** GitHub repository in owner/repo format */
  repo: string;
  /** Branch to sync from (default: repo default branch) */
  branch?: string;
  /** Path within the GitHub repo to sync from */
  sourcePath: string;
  /**
   * Local destination path (relative to workspace root or absolute).
   * Supports ${copilotMemory} token for cross-platform VS Code Copilot memory location.
   */
  destPath: string;
  /** Glob patterns to include (default: all files) */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
}

export interface SyncConfig {
  mappings: SyncMapping[];
}

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a parsed config object against the schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateConfig(config: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!config || typeof config !== 'object') {
    errors.push({ path: '', message: 'Config must be a JSON object' });
    return errors;
  }

  const obj = config as Record<string, unknown>;

  if (!Array.isArray(obj.mappings)) {
    errors.push({ path: 'mappings', message: '"mappings" must be an array' });
    return errors;
  }

  if (obj.mappings.length === 0) {
    errors.push({ path: 'mappings', message: '"mappings" must have at least one entry' });
    return errors;
  }

  // Check for extra top-level keys
  const validTopKeys = new Set(['mappings']);
  for (const key of Object.keys(obj)) {
    if (!validTopKeys.has(key)) {
      errors.push({ path: key, message: `Unknown property "${key}"` });
    }
  }

  const repoPattern = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
  const validMappingKeys = new Set(['name', 'repo', 'branch', 'sourcePath', 'destPath', 'include', 'exclude']);

  for (let i = 0; i < obj.mappings.length; i++) {
    const prefix = `mappings[${i}]`;
    const mapping = obj.mappings[i];

    if (!mapping || typeof mapping !== 'object') {
      errors.push({ path: prefix, message: 'Mapping must be an object' });
      continue;
    }

    const m = mapping as Record<string, unknown>;

    // Check for extra keys
    for (const key of Object.keys(m)) {
      if (!validMappingKeys.has(key)) {
        errors.push({ path: `${prefix}.${key}`, message: `Unknown property "${key}"` });
      }
    }

    // Required fields
    for (const field of ['name', 'repo', 'sourcePath', 'destPath'] as const) {
      if (typeof m[field] !== 'string' || (m[field] as string).trim() === '') {
        errors.push({ path: `${prefix}.${field}`, message: `"${field}" is required and must be a non-empty string` });
      }
    }

    // Repo format
    if (typeof m.repo === 'string' && !repoPattern.test(m.repo)) {
      errors.push({ path: `${prefix}.repo`, message: '"repo" must be in owner/repo format (e.g. "octocat/hello-world")' });
    }

    // Optional branch
    if (m.branch !== undefined && (typeof m.branch !== 'string' || m.branch.trim() === '')) {
      errors.push({ path: `${prefix}.branch`, message: '"branch" must be a non-empty string if provided' });
    }

    // Optional include/exclude arrays
    for (const field of ['include', 'exclude'] as const) {
      if (m[field] !== undefined) {
        if (!Array.isArray(m[field])) {
          errors.push({ path: `${prefix}.${field}`, message: `"${field}" must be an array of strings` });
        } else {
          for (let j = 0; j < (m[field] as unknown[]).length; j++) {
            if (typeof (m[field] as unknown[])[j] !== 'string') {
              errors.push({ path: `${prefix}.${field}[${j}]`, message: `"${field}" entries must be strings` });
            }
          }
        }
      }
    }
  }

  return errors;
}
