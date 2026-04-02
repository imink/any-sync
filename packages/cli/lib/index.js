'use strict';

const { Lockfile, makeKey, hashFile } = require('./lockfile');
const { ghApi, ghApiRetry, getAuthToken } = require('./gh');
const { globMatch, matchesAny } = require('./glob');
const { loadConfig, findConfig, expandTilde, parseMapping, saveConfig } = require('./config');
const { checkAuth } = require('./auth');
const { pull } = require('./pull');
const { push } = require('./push');
const { status } = require('./status');
const { reset } = require('./reset');
const { init, getPresetMappings } = require('./init');
const { autoPull, autoPush } = require('./hooks');

module.exports = {
  // Lockfile
  Lockfile,
  makeKey,
  hashFile,
  // GitHub
  ghApi,
  ghApiRetry,
  getAuthToken,
  // Glob
  globMatch,
  matchesAny,
  // Config
  loadConfig,
  findConfig,
  expandTilde,
  parseMapping,
  saveConfig,
  // Auth
  checkAuth,
  // Operations
  pull,
  push,
  status,
  reset,
  init,
  // Presets & hooks
  getPresetMappings,
  autoPull,
  autoPush,
};
