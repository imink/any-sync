#!/usr/bin/env node
'use strict';

// Auto-pull on session start if config exists and auth is available
const path = require('path');
const fs = require('fs');
const os = require('os');

const pluginDir = path.resolve(__dirname, '..');
const scriptsLib = path.join(pluginDir, 'scripts', 'lib');
const { pull, findConfig, getAuthToken } = require(scriptsLib);

const configPath = findConfig();
if (!configPath) process.exit(0);

const token = getAuthToken();
if (!token) process.exit(0);

const lockfilePath = '.any-sync.lock';

try {
  const result = pull(configPath, lockfilePath);
  const pullCount = (result.pulled || []).length;

  if (pullCount > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `Any Sync: auto-pulled ${pullCount} file(s) from GitHub. Use /any-sync:status for details.`,
      },
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }
} catch {
  // Silently exit on errors — don't block session start
  process.exit(0);
}
