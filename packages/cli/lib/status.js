'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Lockfile, makeKey, hashFile } = require('./lockfile');
const { matchesAny } = require('./glob');
const { loadConfig, parseMapping } = require('./config');

/**
 * Walk a directory recursively, returning relative file paths.
 */
function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const parent = entry.parentPath || entry.path;
      const fullPath = path.join(parent, entry.name);
      results.push(path.relative(dir, fullPath).split(path.sep).join('/'));
    }
  }
  return results;
}

/**
 * Get sync status.
 * Returns: { auth: {...}, config: {...}, mappings: [...] }
 */
function status(configPath, lockfilePath) {
  // Check auth
  let authMethod = 'none';
  let authUser = '';

  if (process.env.GITHUB_TOKEN) {
    authMethod = 'token';
    try {
      authUser = execFileSync('gh', ['api', '/user', '--jq', '.login'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      authUser = 'unknown';
    }
  } else {
    try {
      execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      authMethod = 'gh';
      try {
        authUser = execFileSync('gh', ['api', '/user', '--jq', '.login'], {
          encoding: 'utf8',
        }).trim();
      } catch {
        authUser = 'unknown';
      }
    } catch {
      // No auth
    }
  }

  // Check config
  let configValid = false;
  let config = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(config.mappings)) {
        configValid = true;
      }
    } catch {
      // Invalid config
    }
  }

  const lf = Lockfile.load(lockfilePath);
  const mappings = [];

  if (configValid && config) {
    for (const raw of config.mappings) {
      const m = parseMapping(raw);
      const lastSync = lf.getLastSync(m.name);
      const entries = lf.getEntriesForMapping(m.name);
      const trackedFiles = Object.keys(entries).length;
      const changes = [];

      // Check tracked files for local modifications
      for (const [relPath, entry] of Object.entries(entries)) {
        const localFile = path.join(m.destPath, relPath);
        if (fs.existsSync(localFile)) {
          const currentHash = hashFile(localFile);
          if (currentHash !== entry.localHash) {
            changes.push({ file: relPath, type: 'modified' });
          }
        }
      }

      // Check for new and untracked files
      const untracked = [];
      if (fs.existsSync(m.destPath)) {
        const localFiles = walkDir(m.destPath);
        for (const relPath of localFiles) {
          // Apply exclude filter first — excluded files are never relevant
          if (m.exclude.length > 0 && matchesAny(m.exclude, relPath)) continue;

          const lockKey = makeKey(m.name, relPath);
          const isTracked = !!lf.getEntry(lockKey);

          if (m.include.length > 0 && !matchesAny(m.include, relPath)) {
            // File doesn't match include patterns — it's untracked (only if not already tracked)
            if (!isTracked) {
              untracked.push({ file: relPath });
            }
            continue;
          }

          // File matches filters — check if it's new
          if (!isTracked) {
            changes.push({ file: relPath, type: 'new' });
          }
        }
      }

      mappings.push({
        name: m.name,
        repo: m.repo,
        branch: m.branch,
        lastSync,
        trackedFiles,
        changes,
        untracked,
      });
    }
  }

  return {
    auth: { method: authMethod, user: authUser },
    config: { path: configPath, valid: configValid },
    mappings,
  };
}

module.exports = { status };
