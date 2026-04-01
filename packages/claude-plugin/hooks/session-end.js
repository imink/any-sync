#!/usr/bin/env node
'use strict';

// Auto-push local changes on session end (direct to branch, no confirmation)
const path = require('path');
const fs = require('fs');
const os = require('os');

const pluginDir = path.resolve(__dirname, '..');
const scriptsLib = path.join(pluginDir, 'scripts', 'lib');
const { status, push, findConfig, getAuthToken } = require(scriptsLib);

const configPath = findConfig();
if (!configPath) process.exit(0);

const token = getAuthToken();
if (!token) process.exit(0);

const lockfilePath = '.any-sync.lock';

try {
  const result = status(configPath, lockfilePath);
  const hasChanges = (result.mappings || []).some(m => (m.changes || []).length > 0);

  if (hasChanges) {
    push(configPath, lockfilePath);
  }
} catch {
  // Silently exit on errors — don't block session end
  process.exit(0);
}
