'use strict';

const fs = require('fs');
const path = require('path');
const { Lockfile, makeKey, hashFile } = require('./lockfile');
const { ghApiRetry } = require('./gh');
const { matchesAny } = require('./glob');
const { loadConfig, parseMapping } = require('./config');
const { checkAuth } = require('./auth');

/**
 * Pull files from GitHub.
 * Returns: { pulled: [...], conflicts: [...], skipped: [...] }
 */
function pull(configPath, lockfilePath) {
  const config = loadConfig(configPath);
  const token = checkAuth();
  process.env.GITHUB_TOKEN = token;

  const lf = Lockfile.load(lockfilePath);
  const pulled = [];
  const conflicts = [];
  const skipped = [];

  for (const raw of config.mappings) {
    const m = parseMapping(raw);
    const [owner, repoName] = m.repo.split('/');
    const prefix = m.sourcePath ? m.sourcePath + '/' : '';

    // Fetch recursive tree
    let treeOutput;
    try {
      treeOutput = ghApiRetry([
        `/repos/${owner}/${repoName}/git/trees/${m.branch}?recursive=1`,
        '--jq', '.tree[] | select(.type == "blob") | [.path, .sha] | @tsv',
      ]);
    } catch (err) {
      process.stderr.write(`Error: Failed to fetch tree for ${m.repo} branch ${m.branch}\n`);
      continue;
    }

    if (!treeOutput) {
      lf.setLastSync(m.name);
      continue;
    }

    const entries = treeOutput.split('\n').filter(Boolean).map(line => {
      const [filePath, sha] = line.split('\t');
      return { path: filePath, sha };
    });

    for (const entry of entries) {
      // Filter by prefix
      if (prefix && !entry.path.startsWith(prefix)) continue;

      const relPath = prefix ? entry.path.slice(prefix.length) : entry.path;

      // Apply include filter
      if (m.include.length > 0 && !matchesAny(m.include, relPath)) continue;

      // Apply exclude filter
      if (m.exclude.length > 0 && matchesAny(m.exclude, relPath)) continue;

      const lockKey = makeKey(m.name, relPath);
      const existing = lf.getEntry(lockKey);
      const localFile = path.join(m.destPath, relPath);

      if (existing) {
        // Remote unchanged → skip
        if (existing.remoteSha === entry.sha) {
          skipped.push({ file: relPath, mapping: m.name, reason: 'unchanged' });
          continue;
        }

        // Remote changed — check if local also changed
        if (fs.existsSync(localFile)) {
          const currentHash = hashFile(localFile);
          if (currentHash !== existing.localHash) {
            conflicts.push({ file: relPath, mapping: m.name });
            continue;
          }
        }
      }

      // Download blob
      let blobContent;
      try {
        blobContent = ghApiRetry([
          `/repos/${owner}/${repoName}/git/blobs/${entry.sha}`,
          '--jq', '.content',
        ]);
      } catch (err) {
        process.stderr.write(`Error: Failed to download blob for ${relPath}\n`);
        continue;
      }

      // Write file atomically
      const dir = path.dirname(localFile);
      fs.mkdirSync(dir, { recursive: true });
      const decoded = Buffer.from(blobContent.trim(), 'base64');
      const tmp = localFile + '.' + require('crypto').randomUUID();
      fs.writeFileSync(tmp, decoded);
      fs.renameSync(tmp, localFile);

      // Update lockfile
      const newHash = hashFile(localFile);
      lf.setEntry(lockKey, entry.sha, newHash);
      pulled.push({ file: relPath, mapping: m.name });
    }

    lf.setLastSync(m.name);
  }

  lf.save();
  return { pulled, conflicts, skipped };
}

module.exports = { pull };
