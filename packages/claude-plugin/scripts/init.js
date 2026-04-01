#!/usr/bin/env node
'use strict';

const { init } = require('./lib');

const configPath = process.argv[2];
const repo = process.argv[3];
const branch = process.argv[4] || 'main';

if (!configPath || !repo) {
  process.stderr.write('Usage: init.js <config-path> <repo> [branch]\n');
  process.exit(1);
}

const claudeMappings = [
  { name: 'claude-skills', sourcePath: 'skills', destPath: '~/.claude/skills', include: ['**/*.md'] },
  { name: 'claude-memory', sourcePath: 'memory', destPath: '~/.claude/memory' },
  { name: 'claude-settings', sourcePath: 'settings', destPath: '~/.claude', include: ['settings.json'] },
];

try {
  const result = init(configPath, repo, branch, claudeMappings);
  process.stdout.write(result + '\n');
} catch (err) {
  process.stderr.write('Error: ' + err.message + '\n');
  process.exit(1);
}
