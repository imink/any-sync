'use strict';

const { findConfig } = require('./config');
const { getAuthToken } = require('./gh');
const { pull } = require('./pull');
const { push } = require('./push');
const { status } = require('./status');

/**
 * Auto-pull if config and auth are available.
 * Returns the pull result, or null if skipped.
 */
function autoPull(lockfilePath) {
  lockfilePath = lockfilePath || '.any-sync.lock';

  const configPath = findConfig();
  if (!configPath) return null;

  const token = getAuthToken();
  if (!token) return null;

  return pull(configPath, lockfilePath);
}

/**
 * Auto-push if config and auth are available and there are changes.
 * Returns the push result, or null if skipped.
 */
function autoPush(lockfilePath) {
  lockfilePath = lockfilePath || '.any-sync.lock';

  const configPath = findConfig();
  if (!configPath) return null;

  const token = getAuthToken();
  if (!token) return null;

  const statusResult = status(configPath, lockfilePath);
  const hasChanges = (statusResult.mappings || []).some(m => (m.changes || []).length > 0);
  if (!hasChanges) return null;

  return push(configPath, lockfilePath);
}

module.exports = { autoPull, autoPush };
