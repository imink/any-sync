'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Lockfile, makeKey, hashFile } = require('./lockfile');
const { ghApiRetry } = require('./gh');
const { matchesAny } = require('./glob');
const { loadConfig, parseMapping } = require('./config');
const { checkAuth } = require('./auth');

/**
 * Walk a directory recursively, returning relative file paths.
 */
function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      // entry.parentPath is available in Node 20+, fallback to entry.path
      const parent = entry.parentPath || entry.path;
      const fullPath = path.join(parent, entry.name);
      const relPath = path.relative(dir, fullPath).split(path.sep).join('/');
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Push local changes to GitHub.
 * Returns: { pushed: [...], branch: "..." }
 */
function push(configPath, lockfilePath) {
  const config = loadConfig(configPath);
  const token = checkAuth();
  process.env.GITHUB_TOKEN = token;

  const lf = Lockfile.load(lockfilePath);
  const allPushed = [];
  let lastBranch = 'main';

  for (const raw of config.mappings) {
    const m = parseMapping(raw);
    const [owner, repoName] = m.repo.split('/');
    lastBranch = m.branch;

    if (!fs.existsSync(m.destPath)) continue;

    const localFiles = walkDir(m.destPath);
    const treeEntries = [];

    for (const relPath of localFiles) {
      // Apply include filter
      if (m.include.length > 0 && !matchesAny(m.include, relPath)) continue;

      // Apply exclude filter
      if (m.exclude.length > 0 && matchesAny(m.exclude, relPath)) continue;

      const localFile = path.join(m.destPath, relPath);
      const lockKey = makeKey(m.name, relPath);
      const existing = lf.getEntry(lockKey);
      const currentHash = hashFile(localFile);

      // Check if changed
      let isChanged = false;
      if (!existing) {
        isChanged = true; // New file
      } else if (currentHash !== existing.localHash) {
        isChanged = true; // Modified
      }

      if (!isChanged) continue;

      // Construct repo path
      const repoPath = m.sourcePath ? m.sourcePath + '/' + relPath : relPath;

      // Create blob (base64 encoded, piped via stdin)
      const content = fs.readFileSync(localFile).toString('base64');
      const blobPayload = JSON.stringify({ content, encoding: 'base64' });

      let blobSha;
      try {
        blobSha = ghApiRetry(
          [`/repos/${owner}/${repoName}/git/blobs`, '--input', '-', '--jq', '.sha'],
          { input: blobPayload }
        );
      } catch (err) {
        process.stderr.write(`Error: Failed to create blob for ${relPath}\n`);
        process.exit(1);
      }

      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blobSha });
      allPushed.push({ file: relPath, mapping: m.name, blobSha, localHash: currentHash });
    }

    if (treeEntries.length === 0) continue;

    // Get current commit SHA
    let commitSha;
    try {
      commitSha = ghApiRetry([
        `/repos/${owner}/${repoName}/git/ref/heads/${m.branch}`,
        '--jq', '.object.sha',
      ]);
    } catch (err) {
      process.stderr.write(`Error: Failed to get commit SHA for branch ${m.branch}\n`);
      process.exit(1);
    }

    // Get base tree SHA
    let baseTreeSha;
    try {
      baseTreeSha = ghApiRetry([
        `/repos/${owner}/${repoName}/git/commits/${commitSha}`,
        '--jq', '.tree.sha',
      ]);
    } catch (err) {
      process.stderr.write('Error: Failed to get base tree SHA\n');
      process.exit(1);
    }

    // Create new tree
    const treePayload = JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries });
    let newTreeSha;
    try {
      newTreeSha = ghApiRetry(
        [`/repos/${owner}/${repoName}/git/trees`, '--input', '-', '--jq', '.sha'],
        { input: treePayload }
      );
    } catch (err) {
      process.stderr.write('Error: Failed to create tree\n');
      process.exit(1);
    }

    // Create commit
    let commitMsg;
    if (treeEntries.length === 1) {
      commitMsg = `sync: Update ${treeEntries[0].path} via Any Sync`;
    } else {
      commitMsg = `sync: Update ${treeEntries.length} file(s) in ${m.sourcePath} via Any Sync`;
    }

    const commitPayload = JSON.stringify({
      message: commitMsg,
      tree: newTreeSha,
      parents: [commitSha],
    });

    let newCommitSha;
    try {
      newCommitSha = ghApiRetry(
        [`/repos/${owner}/${repoName}/git/commits`, '--input', '-', '--jq', '.sha'],
        { input: commitPayload }
      );
    } catch (err) {
      process.stderr.write('Error: Failed to create commit\n');
      process.exit(1);
    }

    // Update branch ref
    try {
      ghApiRetry([
        '-X', 'PATCH',
        `/repos/${owner}/${repoName}/git/refs/heads/${m.branch}`,
        '-f', `sha=${newCommitSha}`,
      ]);
    } catch (err) {
      process.stderr.write('Error: Failed to update branch ref. Another push may have occurred — try pulling first.\n');
      process.exit(1);
    }

    // Update lockfile for pushed files
    for (const p of allPushed) {
      if (p.mapping !== m.name) continue;
      const lockKey = makeKey(m.name, p.file);
      lf.setEntry(lockKey, p.blobSha, p.localHash);
    }

    lf.setLastSync(m.name);
  }

  lf.save();
  return {
    pushed: allPushed.map(p => ({ file: p.file, mapping: p.mapping })),
    branch: lastBranch,
  };
}

module.exports = { push };
