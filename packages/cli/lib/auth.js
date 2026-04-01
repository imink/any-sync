'use strict';

const { execFileSync } = require('child_process');

/**
 * Check GitHub authentication.
 * Returns the auth token string.
 * Throws if no auth available.
 */
function checkAuth() {
  // 1. Check GITHUB_TOKEN env var
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // 2. Try gh CLI auth
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) return token;
  } catch {
    // Fall through
  }

  // 3. No auth available
  throw new Error(
    'No GitHub authentication found.\n\n' +
      'Set up authentication using one of:\n' +
      '  1. Set GITHUB_TOKEN environment variable\n' +
      "  2. Run 'gh auth login' to authenticate with GitHub CLI"
  );
}

module.exports = { checkAuth };
