#!/usr/bin/env node
'use strict';

// Auto-push local changes on session end using @any-sync/cli
// Uses detached spawn so the hook exits immediately and doesn't get cancelled.
const { spawn } = require('child_process');
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

const lockfilePath = path.join(path.dirname(configPath), '.any-sync.lock');

// Spawn a detached process that checks for changes and pushes if needed.
// This lets the hook script exit immediately so Claude Code doesn't cancel it.
const script = `
  const cli = require('@any-sync/cli');
  try {
    const st = cli.status(${JSON.stringify(configPath)}, ${JSON.stringify(lockfilePath)});
    const hasChanges = (st.mappings || []).some(m => (m.changes || []).length > 0);
    if (hasChanges) {
      cli.push(${JSON.stringify(configPath)}, ${JSON.stringify(lockfilePath)});
    }
  } catch {}
`;

const child = spawn(process.execPath, ['-e', script], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env },
});
child.unref();
