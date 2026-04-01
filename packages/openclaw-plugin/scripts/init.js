#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const { init } = require('../../shared-scripts/lib');

const configPath = process.argv[2];
const repo = process.argv[3];
const branch = process.argv[4] || 'main';

if (!configPath || !repo) {
  process.stderr.write('Usage: init.js <config-path> <repo> [branch]\n');
  process.exit(1);
}

// Resolve OpenClaw workspace path (profile-aware)
let workspace = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const profile = process.env.OPENCLAW_PROFILE;
if (profile && profile !== 'default') {
  workspace = path.join(os.homedir(), '.openclaw', `workspace-${profile}`);
}

const openclawMappings = [
  { name: 'workspace-skills', sourcePath: 'skills', destPath: path.join(workspace, 'skills') },
  { name: 'workspace-memory', sourcePath: 'memory', destPath: path.join(workspace, 'memory') },
  {
    name: 'workspace-config',
    sourcePath: 'config',
    destPath: workspace,
    include: ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'],
  },
];

try {
  const result = init(configPath, repo, branch, openclawMappings);
  process.stdout.write(result + '\n');
} catch (err) {
  process.stderr.write('Error: ' + err.message + '\n');
  process.exit(1);
}
