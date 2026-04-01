'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Create a config file with the given mappings.
 * If config already exists, returns the path without overwriting.
 */
function init(configPath, repo, branch, mappings) {
  // Validate repo format
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    throw new Error('Invalid repo format. Use owner/repo (e.g., myuser/my-sync-repo)');
  }

  // Validate branch name
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) {
    throw new Error('Invalid branch name. Use alphanumeric characters, hyphens, underscores, dots, or slashes.');
  }

  // If config already exists, return path
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  // Create parent directory
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  // Build config with repo/branch applied to each mapping
  const config = {
    mappings: mappings.map(m => ({
      name: m.name,
      repo,
      branch,
      sourcePath: m.sourcePath,
      destPath: m.destPath,
      ...(m.include ? { include: m.include } : {}),
      ...(m.exclude ? { exclude: m.exclude } : {}),
    })),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath;
}

/**
 * Return default mappings for a known preset.
 * Returns null for unknown presets.
 */
function getPresetMappings(preset) {
  const os = require('os');

  switch (preset) {
    case 'claude':
      return [
        {
          name: 'claude-skills',
          sourcePath: 'skills',
          destPath: '~/.claude/skills',
          include: ['**/*.md'],
        },
        { name: 'claude-memory', sourcePath: 'memory', destPath: '~/.claude/memory' },
        {
          name: 'claude-settings',
          sourcePath: 'settings',
          destPath: '~/.claude',
          include: ['settings.json'],
        },
      ];

    case 'openclaw': {
      let workspace =
        process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
      const profile = process.env.OPENCLAW_PROFILE;
      if (profile && profile !== 'default') {
        workspace = path.join(os.homedir(), '.openclaw', `workspace-${profile}`);
      }
      return [
        {
          name: 'workspace-skills',
          sourcePath: 'skills',
          destPath: path.join(workspace, 'skills'),
        },
        {
          name: 'workspace-memory',
          sourcePath: 'memory',
          destPath: path.join(workspace, 'memory'),
        },
        {
          name: 'workspace-config',
          sourcePath: 'config',
          destPath: workspace,
          include: ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'],
        },
      ];
    }

    default:
      return null;
  }
}

module.exports = { init, getPresetMappings };
