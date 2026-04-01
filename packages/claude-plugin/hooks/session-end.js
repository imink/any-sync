#!/usr/bin/env node
'use strict';

// Auto-push local changes on session end using @any-sync/cli
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
  // Check for changes first
  const statusOutput = execFileSync(
    'npx',
    ['@any-sync/cli', 'status', configPath, '.any-sync.lock'],
    { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const statusResult = JSON.parse(statusOutput);
  const hasChanges = (statusResult.mappings || []).some(m => (m.changes || []).length > 0);

  if (hasChanges) {
    execFileSync('npx', ['@any-sync/cli', 'push', configPath, '.any-sync.lock'], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
} catch {
  // Silently exit on errors — don't block session end
  process.exit(0);
}
