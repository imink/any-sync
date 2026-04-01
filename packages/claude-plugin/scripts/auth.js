#!/usr/bin/env node
'use strict';

const { checkAuth } = require('./lib');

try {
  const token = checkAuth();
  process.stdout.write(token + '\n');
} catch (err) {
  process.stderr.write(err.message + '\n');
  process.exit(1);
}
