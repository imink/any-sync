#!/usr/bin/env node
'use strict';

const { push } = require('../lib');

const configPath = process.argv[2];
const lockfilePath = process.argv[3] || '.any-sync.lock';

if (!configPath) {
  process.stderr.write('Usage: push.js <config-path> [lockfile-path]\n');
  process.exit(1);
}

try {
  const result = push(configPath, lockfilePath);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (err) {
  process.stderr.write('Error: ' + err.message + '\n');
  process.exit(1);
}
