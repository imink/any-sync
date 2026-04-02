#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const COMMANDS = {
  pull: 'Pull files from GitHub',
  push: 'Push local changes to GitHub',
  status: 'Show sync status',
  reset: 'Remove config and lockfile',
  auth: 'Check GitHub authentication',
  init: 'Create config file (use --preset for defaults)',
  'update-config': 'Update config mappings (add include patterns)',
};

function usage() {
  process.stdout.write(`any-sync v${pkg.version} — bidirectional GitHub file sync\n\n`);
  process.stdout.write('Usage: any-sync <command> [options]\n\n');
  process.stdout.write('Commands:\n');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    process.stdout.write(`  ${cmd.padEnd(10)} ${desc}\n`);
  }
  process.stdout.write('\nRun any-sync <command> --help for command-specific usage.\n');
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (!COMMANDS[command]) {
  process.stderr.write(`Unknown command: ${command}\n`);
  process.stderr.write('Run any-sync --help for available commands.\n');
  process.exit(1);
}

const lib = require('../lib');
const cmdArgs = args.slice(1);

try {
  switch (command) {
    case 'pull': {
      const configPath = cmdArgs[0];
      const lockfilePath = cmdArgs[1] || '.any-sync.lock';
      if (!configPath || cmdArgs.includes('--help')) {
        process.stdout.write('Usage: any-sync pull <config-path> [lockfile-path]\n');
        process.exit(cmdArgs.includes('--help') ? 0 : 1);
      }
      const result = lib.pull(configPath, lockfilePath);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }

    case 'push': {
      const configPath = cmdArgs[0];
      const lockfilePath = cmdArgs[1] || '.any-sync.lock';
      if (!configPath || cmdArgs.includes('--help')) {
        process.stdout.write('Usage: any-sync push <config-path> [lockfile-path]\n');
        process.exit(cmdArgs.includes('--help') ? 0 : 1);
      }
      const result = lib.push(configPath, lockfilePath);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }

    case 'status': {
      const configPath = cmdArgs[0];
      const lockfilePath = cmdArgs[1] || '.any-sync.lock';
      if (!configPath || cmdArgs.includes('--help')) {
        process.stdout.write('Usage: any-sync status <config-path> [lockfile-path]\n');
        process.exit(cmdArgs.includes('--help') ? 0 : 1);
      }
      const result = lib.status(configPath, lockfilePath);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }

    case 'reset': {
      const configPath = cmdArgs[0];
      const lockfilePath = cmdArgs[1] || '.any-sync.lock';
      if (!configPath || cmdArgs.includes('--help')) {
        process.stdout.write('Usage: any-sync reset <config-path> [lockfile-path]\n');
        process.exit(cmdArgs.includes('--help') ? 0 : 1);
      }
      const result = lib.reset(configPath, lockfilePath);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }

    case 'auth': {
      if (cmdArgs.includes('--help')) {
        process.stdout.write('Usage: any-sync auth\n');
        process.exit(0);
      }
      const token = lib.checkAuth();
      process.stdout.write(token + '\n');
      break;
    }

    case 'init': {
      if (cmdArgs.includes('--help')) {
        process.stdout.write(
          'Usage: any-sync init <config-path> <repo> [branch] [--preset claude|openclaw]\n',
        );
        process.exit(0);
      }
      // Parse --preset flag
      const presetIdx = cmdArgs.indexOf('--preset');
      let preset = null;
      const positional = [];
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--preset') {
          preset = cmdArgs[++i];
        } else {
          positional.push(cmdArgs[i]);
        }
      }
      const configPath = positional[0];
      const repo = positional[1];
      const branch = positional[2] || 'main';
      if (!configPath || !repo) {
        process.stderr.write(
          'Usage: any-sync init <config-path> <repo> [branch] [--preset claude|openclaw]\n',
        );
        process.exit(1);
      }
      let mappings;
      if (preset) {
        mappings = lib.getPresetMappings(preset);
        if (!mappings) {
          process.stderr.write(`Unknown preset: ${preset}. Available: claude, openclaw\n`);
          process.exit(1);
        }
      } else {
        process.stderr.write('Error: --preset is required. Available: claude, openclaw\n');
        process.exit(1);
      }
      const result = lib.init(configPath, repo, branch, mappings);
      process.stdout.write(result + '\n');
      break;
    }

    case 'update-config': {
      if (cmdArgs.includes('--help')) {
        process.stdout.write(
          'Usage: any-sync update-config <config-path> <mapping-name> --add-include <pattern> [--add-include <pattern> ...]\n',
        );
        process.exit(0);
      }
      const positional = [];
      const addInclude = [];
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--add-include') {
          addInclude.push(cmdArgs[++i]);
        } else {
          positional.push(cmdArgs[i]);
        }
      }
      const configPath = positional[0];
      const mappingName = positional[1];
      if (!configPath || !mappingName || addInclude.length === 0) {
        process.stderr.write(
          'Usage: any-sync update-config <config-path> <mapping-name> --add-include <pattern> [--add-include <pattern> ...]\n',
        );
        process.exit(1);
      }
      const config = lib.loadConfig(configPath);
      const mapping = config.mappings.find(m => m.name === mappingName);
      if (!mapping) {
        process.stderr.write(`Error: Mapping "${mappingName}" not found in config\n`);
        process.exit(1);
      }
      if (!mapping.include) mapping.include = [];
      for (const pattern of addInclude) {
        if (!mapping.include.includes(pattern)) {
          mapping.include.push(pattern);
        }
      }
      lib.saveConfig(configPath, config);
      process.stdout.write(JSON.stringify({ updated: mappingName, include: mapping.include }) + '\n');
      break;
    }
  }
} catch (err) {
  process.stderr.write('Error: ' + err.message + '\n');
  process.exit(1);
}
