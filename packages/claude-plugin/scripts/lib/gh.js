'use strict';

const { execFileSync } = require('child_process');

/**
 * Call gh api with the given arguments.
 * For POST/PATCH with a body, pass the body string as opts.input.
 */
function ghApi(args, opts = {}) {
  const options = { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 };
  if (opts.input) {
    options.input = opts.input;
  }
  return execFileSync('gh', ['api', ...args], options).trim();
}

/**
 * Retry gh api on 5xx/network errors with exponential backoff.
 */
function ghApiRetry(args, opts = {}) {
  const maxAttempts = opts.maxAttempts || 3;
  let backoff = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return ghApi(args, opts);
    } catch (err) {
      const msg = (err.stderr || err.message || '').toString();
      const isRetryable = /50[0234]|connect|timeout|network/i.test(msg);
      if (!isRetryable || attempt === maxAttempts - 1) {
        throw err;
      }
      // Synchronous sleep via Atomics
      const buf = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(buf), 0, 0, backoff);
      backoff *= 2;
    }
  }
}

/**
 * Get GitHub auth token from GITHUB_TOKEN env or gh auth token.
 */
function getAuthToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

module.exports = { ghApi, ghApiRetry, getAuthToken };
