'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Load and validate a config file.
 * Returns the parsed config object.
 */
function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error('Config file not found: ' + configPath);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.mappings)) {
    throw new Error('Invalid config: missing "mappings" array');
  }
  return config;
}

/**
 * Find config file. Checks $HOME/.any-sync.json first, then cwd.
 * Returns the path or null.
 */
function findConfig() {
  const home = path.join(os.homedir(), '.any-sync.json');
  if (fs.existsSync(home)) return home;
  const local = path.resolve('.any-sync.json');
  if (fs.existsSync(local)) return local;
  return null;
}

/**
 * Expand ~ to home directory in a path.
 */
function expandTilde(p) {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Parse a mapping entry, applying defaults and expanding paths.
 */
function parseMapping(m) {
  return {
    name: m.name,
    repo: m.repo,
    branch: m.branch || 'main',
    sourcePath: (m.sourcePath || '').replace(/^\/+|\/+$/g, ''),
    destPath: expandTilde(m.destPath),
    include: m.include || [],
    exclude: m.exclude || [],
  };
}

/**
 * Save a config object to disk atomically.
 */
function saveConfig(configPath, config) {
  const tmpPath = configPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, configPath);
}

module.exports = { loadConfig, findConfig, expandTilde, parseMapping, saveConfig };
