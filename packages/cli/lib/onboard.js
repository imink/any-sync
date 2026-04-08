'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { getPresetMappings } = require('./init');
const { findConfig, saveConfig } = require('./config');
const { getAuthToken } = require('./gh');
const { pull } = require('./pull');

// ── Helpers ──────────────────────────────────────────────────────────────────

function isToolInstalled(name) {
  try {
    execFileSync('which', [name], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function write(output, text) {
  output.write(text);
}

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Detect which tools are installed on the system.
 */
function detectTools() {
  return {
    gh: isToolInstalled('gh'),
    claude: isToolInstalled('claude'),
    openclaw: isToolInstalled('openclaw'),
    code: isToolInstalled('code'),
  };
}

/**
 * Merge mappings from multiple presets into a single array.
 */
function mergePresetMappings(presetNames) {
  const mappings = [];
  for (const name of presetNames) {
    const preset = getPresetMappings(name);
    if (preset) mappings.push(...preset);
  }
  return mappings;
}

/**
 * Interactive onboard wizard.
 *
 * @param {object} opts
 * @param {string}   [opts.repo]       - GitHub repo (skip prompt)
 * @param {string}   [opts.branch]     - Branch (default: 'main')
 * @param {string[]} [opts.presets]    - Presets to enable (skip prompt)
 * @param {boolean}  [opts.pull]       - Run initial pull (default: true)
 * @param {string}   [opts.configPath] - Config path (default: ~/.any-sync.json)
 * @param {boolean}  [opts.force]      - Overwrite existing config
 * @param {NodeJS.ReadableStream} [opts.input]  - Input stream (default: stdin)
 * @param {NodeJS.WritableStream} [opts.output] - Output stream (default: stderr)
 */
async function onboard(opts = {}) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stderr;
  const configPath = opts.configPath || path.join(os.homedir(), '.any-sync.json');
  const branch = opts.branch || 'main';
  const doPull = opts.pull !== false;
  const interactive = !opts.repo || !opts.presets;

  // If interactive but not a TTY, bail
  if (interactive && input === process.stdin && !process.stdin.isTTY) {
    throw new Error(
      'Interactive mode requires a terminal. Use --repo and --preset flags for non-interactive setup.',
    );
  }

  const rl = interactive
    ? readline.createInterface({ input, output, terminal: input.isTTY !== false })
    : null;

  try {
    return await _runWizard({ rl, output, configPath, branch, doPull, opts });
  } finally {
    if (rl) rl.close();
  }
}

async function _runWizard({ rl, output, configPath, branch, doPull, opts }) {
  const result = {
    configPath,
    repo: null,
    branch,
    presets: [],
    mappingCount: 0,
    toolsDetected: [],
    pullResult: null,
    pluginInstructions: [],
  };

  // ── Step 1: Welcome ────────────────────────────────────────────────────────
  write(output, '\nWelcome to Any Sync setup!\n');
  write(output, 'This wizard will configure file sync between your tools and GitHub.\n\n');

  // ── Step 2: Prerequisites ──────────────────────────────────────────────────
  write(output, 'Checking prerequisites...\n');
  const tools = detectTools();

  const nodeVersion = process.versions.node;
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
  write(output, `  Node.js:    v${nodeVersion} ${nodeMajor >= 18 ? '(OK)' : '(WARNING: v18+ recommended)'}\n`);
  write(output, `  gh CLI:     ${tools.gh ? 'installed (OK)' : 'not found'}\n`);
  if (tools.claude) result.toolsDetected.push('claude');
  if (tools.openclaw) result.toolsDetected.push('openclaw');
  if (tools.code) result.toolsDetected.push('code');
  write(output, `  Claude:     ${tools.claude ? 'detected' : 'not found'}\n`);
  write(output, `  OpenClaw:   ${tools.openclaw ? 'detected' : 'not found'}\n`);
  write(output, `  VS Code:    ${tools.code ? 'detected' : 'not found'}\n`);
  write(output, '\n');

  if (!tools.gh) {
    throw new Error(
      'gh CLI is required but not installed.\n' +
        'Install it from https://cli.github.com/ then re-run: any-sync onboard',
    );
  }

  // ── Step 3: Auth ───────────────────────────────────────────────────────────
  const token = getAuthToken();
  if (!token) {
    throw new Error(
      'GitHub authentication not found.\n' +
        'Please authenticate using one of:\n' +
        "  1. Run 'gh auth login'\n" +
        '  2. Set GITHUB_TOKEN environment variable\n\n' +
        'Then re-run: any-sync onboard',
    );
  }
  write(output, '  GitHub auth: authenticated (OK)\n\n');

  // ── Step 4: Existing config ────────────────────────────────────────────────
  const existingConfig = findConfig();
  if (existingConfig && !opts.force) {
    if (rl) {
      const overwrite = await ask(rl, `Existing config found at ${existingConfig}. Overwrite? [y/N]`, 'n');
      if (overwrite.toLowerCase() !== 'y') {
        write(output, 'Setup cancelled. Your existing config is unchanged.\n');
        return result;
      }
    } else {
      throw new Error(
        `Config already exists at ${existingConfig}. Use --force to overwrite.`,
      );
    }
  }

  // ── Step 5: Repo ───────────────────────────────────────────────────────────
  let repo = opts.repo;
  if (!repo && rl) {
    const repoRegex = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
    for (let attempt = 0; attempt < 3; attempt++) {
      repo = await ask(rl, 'GitHub sync repo (owner/repo format)');
      if (repoRegex.test(repo)) break;
      write(output, '  Invalid format. Use owner/repo (e.g., myuser/my-sync-repo)\n');
      if (attempt === 2) throw new Error('Invalid repo format after 3 attempts.');
      repo = null;
    }
  }
  if (!repo) {
    throw new Error('--repo is required in non-interactive mode.');
  }
  result.repo = repo;

  // ── Step 6: Branch ─────────────────────────────────────────────────────────
  if (rl && !opts.branch) {
    result.branch = await ask(rl, 'Branch to sync', 'main');
  }

  // ── Step 7: Tool/preset selection ───────────────────────────────────────────
  let presets = opts.presets;
  let installVscode = false;
  if (!presets && rl) {
    write(output, '\nSelect tools to set up (comma-separated):\n');
    const toolOptions = [
      { key: '1', name: 'claude', label: 'skills, memory, settings', detected: tools.claude },
      { key: '2', name: 'openclaw', label: 'workspace skills, memory, config', detected: tools.openclaw },
      { key: '3', name: 'vscode', label: 'VS Code extension for sync', detected: tools.code },
      { key: '4', name: 'custom', label: 'configure manually later', detected: false },
    ];
    const defaults = [];
    for (const opt of toolOptions) {
      const tag = opt.detected ? ' [detected]' : '';
      write(output, `  ${opt.key}. ${opt.name.padEnd(12)} — ${opt.label}${tag}\n`);
      if (opt.detected && opt.name !== 'custom') defaults.push(opt.key);
    }
    const defaultStr = defaults.length > 0 ? defaults.join(',') : '1';
    const choice = await ask(rl, 'Choice', defaultStr);
    const selected = choice.split(',').map((s) => s.trim());
    presets = [];
    for (const s of selected) {
      const opt = toolOptions.find((o) => o.key === s);
      if (!opt) continue;
      if (opt.name === 'vscode') {
        installVscode = true;
      } else if (opt.name !== 'custom') {
        presets.push(opt.name);
      }
    }
  }
  if (!presets) {
    throw new Error('--preset is required in non-interactive mode.');
  }
  if (opts.presets && opts.presets.includes('vscode')) {
    installVscode = true;
    presets = presets.filter((p) => p !== 'vscode');
  }
  result.presets = presets;

  // ── Step 8: Write config ───────────────────────────────────────────────────
  const mappings = mergePresetMappings(presets);
  const config = {
    mappings: mappings.map((m) => ({
      name: m.name,
      repo,
      branch: result.branch,
      sourcePath: m.sourcePath,
      destPath: m.destPath,
      ...(m.include ? { include: m.include } : {}),
      ...(m.exclude ? { exclude: m.exclude } : {}),
    })),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  saveConfig(configPath, config);
  result.mappingCount = config.mappings.length;
  write(output, `\nConfig written to ${configPath}\n`);

  // ── Step 9: Initial pull ───────────────────────────────────────────────────
  if (doPull && config.mappings.length > 0) {
    write(output, '\nRunning initial pull...\n');
    const lockfilePath = path.join(path.dirname(configPath), '.any-sync.lock');
    try {
      result.pullResult = pull(configPath, lockfilePath);
      const pulled = result.pullResult.pulled || [];
      write(output, `  Pulled ${pulled.length} file(s).\n`);
    } catch (err) {
      write(output, `  Pull failed: ${err.message}\n`);
      write(output, '  Config was saved successfully — you can pull manually later.\n');
    }
  }

  // ── Step 10: Plugin installation ────────────────────────────────────────────
  write(output, '\nNext steps:\n');

  if (presets.includes('claude')) {
    if (tools.claude) {
      write(output, '\n  Installing Claude Code plugin...\n');
      try {
        execFileSync('claude', ['plugin', 'marketplace', 'add', 'imink/any-sync'], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        execFileSync('claude', ['plugin', 'install', 'any-sync@any-sync-marketplace'], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        write(output, '    Any Sync plugin installed successfully.\n');
        result.pluginInstructions.push({ tool: 'claude', installed: true });
      } catch (err) {
        write(output, `    Install failed: ${err.message}\n`);
        write(output, '    Install manually inside Claude Code:\n');
        write(output, '      /plugin marketplace add imink/any-sync\n');
        write(output, '      /plugin install any-sync@any-sync-marketplace\n');
        result.pluginInstructions.push({ tool: 'claude', installed: false });
      }
    } else {
      write(output, '\n  Claude Code not found. Install the plugin manually inside Claude Code:\n');
      write(output, '    /plugin marketplace add imink/any-sync\n');
      write(output, '    /plugin install any-sync@any-sync-marketplace\n');
      result.pluginInstructions.push({ tool: 'claude', installed: false });
    }
  }

  if (presets.includes('openclaw')) {
    if (tools.openclaw) {
      write(output, '\n  Installing OpenClaw plugin...\n');
      try {
        execFileSync('openclaw', ['plugins', 'install', 'any-sync'], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        write(output, '    Any Sync plugin installed successfully.\n');
        result.pluginInstructions.push({ tool: 'openclaw', installed: true });
      } catch (err) {
        write(output, `    Install failed: ${err.message}\n`);
        write(output, '    Install manually: openclaw plugins install any-sync\n');
        result.pluginInstructions.push({ tool: 'openclaw', installed: false });
      }
    } else {
      write(output, '\n  OpenClaw not found. Install the plugin manually:\n');
      write(output, '    openclaw plugins install any-sync\n');
      result.pluginInstructions.push({ tool: 'openclaw', installed: false });
    }
  }

  if (installVscode) {
    if (tools.code) {
      write(output, '\n  Installing VS Code extension...\n');
      try {
        execFileSync('code', ['--install-extension', 'patrickw1029.any-sync'], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        write(output, '    Any Sync extension installed successfully.\n');
        result.pluginInstructions.push({ tool: 'vscode', installed: true });
      } catch (err) {
        write(output, `    Install failed: ${err.message}\n`);
        write(output, '    Install manually: search "any-sync" in VS Code Extensions.\n');
        result.pluginInstructions.push({ tool: 'vscode', installed: false });
      }
    } else {
      write(output, '\n  VS Code not found. Install the extension manually:\n');
      write(output, '    Search "any-sync" in VS Code Extensions, or run:\n');
      write(output, '    code --install-extension patrickw1029.any-sync\n');
      result.pluginInstructions.push({ tool: 'vscode', installed: false });
    }
  }

  // ── Step 11: Summary ───────────────────────────────────────────────────────
  write(output, '\n---\n');
  write(output, 'Setup complete!\n');
  write(output, `  Config:   ${configPath}\n`);
  write(output, `  Repo:     ${repo} (branch: ${result.branch})\n`);
  write(output, `  Presets:  ${presets.length > 0 ? presets.join(', ') : 'custom (edit config manually)'}\n`);
  write(output, `  Mappings: ${result.mappingCount}\n`);
  if (result.pullResult) {
    const pulled = result.pullResult.pulled || [];
    write(output, `  Pulled:   ${pulled.length} file(s)\n`);
  }
  write(output, '\n');

  return result;
}

module.exports = { onboard, detectTools, mergePresetMappings };
