'use strict';

const COMMAND_HELP = {
  pull: {
    usage: 'any-sync pull [config-path] [lockfile-path]',
    description:
      'Download files from GitHub that changed since the last sync.\n' +
      '  Detects conflicts when both local and remote have been modified.\n' +
      '  If no config path is given, searches ~/.any-sync.json then ./.any-sync.json.',
    options: [
      { flag: '[config-path]', desc: 'Path to .any-sync.json (default: auto-detected)' },
      { flag: '[lockfile-path]', desc: 'Path to lockfile (default: alongside config)' },
    ],
    examples: ['any-sync pull', 'any-sync pull ~/.any-sync.json', 'any-sync pull .any-sync.json ./my.lock'],
  },

  push: {
    usage: 'any-sync push [config-path] [lockfile-path]',
    description:
      'Upload local file changes to GitHub.\n' +
      '  Creates a new commit on the configured branch for each mapping with changes.\n' +
      '  If no config path is given, searches ~/.any-sync.json then ./.any-sync.json.',
    options: [
      { flag: '[config-path]', desc: 'Path to .any-sync.json (default: auto-detected)' },
      { flag: '[lockfile-path]', desc: 'Path to lockfile (default: alongside config)' },
    ],
    examples: ['any-sync push', 'any-sync push ~/.any-sync.json', 'any-sync push .any-sync.json ./my.lock'],
  },

  status: {
    usage: 'any-sync status [config-path] [lockfile-path]',
    description:
      'Show sync status including auth method, config validity,\n' +
      '  tracked files, local changes, and untracked files per mapping.\n' +
      '  If no config path is given, searches ~/.any-sync.json then ./.any-sync.json.',
    options: [
      { flag: '[config-path]', desc: 'Path to .any-sync.json (default: auto-detected)' },
      { flag: '[lockfile-path]', desc: 'Path to lockfile (default: alongside config)' },
    ],
    examples: ['any-sync status', 'any-sync status ~/.any-sync.json'],
  },

  reset: {
    usage: 'any-sync reset [config-path] [lockfile-path]',
    description:
      'Remove config and lockfile to start fresh.\n' +
      '  If no config path is given, searches ~/.any-sync.json then ./.any-sync.json.',
    options: [
      { flag: '[config-path]', desc: 'Path to .any-sync.json (default: auto-detected)' },
      { flag: '[lockfile-path]', desc: 'Path to lockfile (default: alongside config)' },
    ],
    examples: ['any-sync reset', 'any-sync reset ~/.any-sync.json'],
  },

  auth: {
    usage: 'any-sync auth',
    description:
      'Check GitHub authentication.\n' +
      '  Looks for GITHUB_TOKEN env var first, then tries gh auth token.',
    options: [],
    examples: ['any-sync auth', 'GITHUB_TOKEN=ghp_xxx any-sync auth'],
  },

  init: {
    usage: 'any-sync init <config-path> <repo> [branch] [--preset claude|openclaw]',
    description:
      'Create a .any-sync.json config file with preset mappings.\n' +
      '  Skips if config already exists at the given path.',
    options: [
      { flag: '<config-path>', desc: 'Path to write config file (required)' },
      { flag: '<repo>', desc: 'GitHub repo in owner/repo format (required)' },
      { flag: '[branch]', desc: 'Branch to sync (default: main)' },
      { flag: '--preset <name>', desc: 'Use preset mappings: claude, openclaw' },
    ],
    examples: [
      'any-sync init ~/.any-sync.json myuser/sync-repo --preset claude',
      'any-sync init .any-sync.json myuser/sync-repo main --preset openclaw',
    ],
  },

  'update-config': {
    usage: 'any-sync update-config <config-path> <mapping-name> --add-include <pattern>',
    description:
      'Add include patterns to an existing mapping.\n' +
      '  Patterns can be specified multiple times.',
    options: [
      { flag: '<config-path>', desc: 'Path to .any-sync.json config file (required)' },
      { flag: '<mapping-name>', desc: 'Name of the mapping to update (required)' },
      { flag: '--add-include <pattern>', desc: 'Glob pattern to add (repeatable)' },
    ],
    examples: [
      'any-sync update-config ~/.any-sync.json claude-skills --add-include "**/*.md"',
      'any-sync update-config ~/.any-sync.json claude-config --add-include "rules/**" --add-include "agents/**"',
    ],
  },

  onboard: {
    usage: 'any-sync onboard [options]',
    description:
      'Interactive setup wizard. Guides you from zero to syncing:\n' +
      '  checks prerequisites, detects tools, creates config, and pulls files.',
    options: [
      { flag: '--repo <owner/repo>', desc: 'GitHub repo (skip prompt)' },
      { flag: '--preset <name>', desc: 'Tool/preset to enable: claude, openclaw, vscode (repeatable)' },
      { flag: '--branch <name>', desc: 'Branch to sync (default: main)' },
      { flag: '--config <path>', desc: 'Config file path (default: ~/.any-sync.json)' },
      { flag: '--no-pull', desc: 'Skip initial pull' },
      { flag: '--force', desc: 'Overwrite existing config without asking' },
    ],
    examples: [
      'any-sync onboard',
      'any-sync onboard --repo myuser/sync-repo --preset claude',
      'any-sync onboard --repo myuser/sync-repo --preset claude --preset vscode',
      'any-sync onboard --repo myuser/sync-repo --preset claude --no-pull',
    ],
  },

  help: {
    usage: 'any-sync help [command]',
    description:
      'Show detailed help for a command.\n' +
      '  Without arguments, shows the list of all commands.',
    options: [{ flag: '[command]', desc: 'Command to show help for' }],
    examples: ['any-sync help', 'any-sync help pull', 'any-sync help onboard'],
  },
};

/**
 * Return formatted help text for a command, or null if unknown.
 */
function commandHelp(name) {
  const entry = COMMAND_HELP[name];
  if (!entry) return null;

  let out = `any-sync ${name} — ${entry.description.split('\n')[0]}\n\n`;
  out += `Usage: ${entry.usage}\n\n`;
  out += `  ${entry.description}\n`;

  if (entry.options.length > 0) {
    out += '\nOptions:\n';
    const maxFlag = Math.max(...entry.options.map((o) => o.flag.length));
    for (const opt of entry.options) {
      out += `  ${opt.flag.padEnd(maxFlag + 2)} ${opt.desc}\n`;
    }
  }

  if (entry.examples.length > 0) {
    out += '\nExamples:\n';
    for (const ex of entry.examples) {
      out += `  ${ex}\n`;
    }
  }

  return out;
}

/**
 * Return the raw help data object for a command, or null if unknown.
 */
function getCommandHelp(name) {
  return COMMAND_HELP[name] || null;
}

module.exports = { commandHelp, getCommandHelp };
