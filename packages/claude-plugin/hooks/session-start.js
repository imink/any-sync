#!/usr/bin/env node
'use strict';

// Auto-pull on session start using @any-sync/cli
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Find config (same logic as lib/config.js findConfig)
const homeConfig = path.join(os.homedir(), '.any-sync.json');
const localConfig = path.resolve('.any-sync.json');
const configPath = fs.existsSync(homeConfig)
  ? homeConfig
  : fs.existsSync(localConfig)
    ? localConfig
    : null;

if (!configPath) process.exit(0);

try {
  const result = execFileSync('npx', ['@any-sync/cli', 'pull', configPath, '.any-sync.lock'], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const parsed = JSON.parse(result);
  const pullCount = (parsed.pulled || []).length;

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
