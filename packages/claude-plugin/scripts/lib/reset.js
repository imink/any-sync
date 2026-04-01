'use strict';

const fs = require('fs');

/**
 * Delete config and lockfile.
 * Returns: { deletedConfig, configPath, deletedLockfile, lockfilePath }
 */
function reset(configPath, lockfilePath) {
  let deletedConfig = false;
  let deletedLockfile = false;

  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    deletedConfig = true;
  }

  if (fs.existsSync(lockfilePath)) {
    fs.unlinkSync(lockfilePath);
    deletedLockfile = true;
  }

  return { deletedConfig, configPath, deletedLockfile, lockfilePath };
}

module.exports = { reset };
