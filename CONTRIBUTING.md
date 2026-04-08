# Contributing to Any Sync

## Monorepo Structure

```
packages/
  vscode-extension/   — TypeScript VS Code extension (esbuild-bundled, Octokit + simple-git)
  claude-plugin/      — Claude Code plugin (SKILL.md slash commands + JS session hooks, uses npx any-sync)
  openclaw-plugin/    — OpenClaw plugin (TypeScript entry + JS skills/hooks, uses @any-sync/cli)
  cli/                — Core JS sync library + CLI (any-sync pull/push/status/reset/auth/init)
```

## Prerequisites

- **Node.js** (v18+)
- **`gh` CLI** — GitHub API calls and authentication
- **npm** — workspace dependency management

## Development

```bash
# Install all dependencies
npm install

# Build the VS Code extension
npm run build

# Watch mode
npm run watch

# Run VS Code extension tests
npm run test

# Run all package tests
npm run test:all

# Lint
npm run lint
```

## Local Plugin Installation (for testing)

### Claude Code Plugin

```bash
# From CLI (one-time marketplace registration)
claude plugin marketplace add /absolute/path/to/packages/claude-plugin/.claude-plugin/marketplace.json
claude plugin install any-sync@any-sync-marketplace

# Or load for a single session
claude --plugin-dir ./packages/claude-plugin
```

### OpenClaw Plugin

```bash
openclaw plugins install -l ./packages/openclaw-plugin
```

### VS Code Extension

Press F5 in VS Code to launch Extension Development Host.

## Publishing

### VS Code Extension

#### Prerequisites

1. Create a publisher account on the [VS Code Marketplace](https://marketplace.visualstudio.com/manage).
2. Generate a Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com) with the **Marketplace > Manage** scope.

#### Login

```bash
cd packages/vscode-extension
npx @vscode/vsce login patrickw1029
```

#### Package

```bash
npm run package
# Produces packages/vscode-extension/any-sync-<version>.vsix
```

#### Publish

```bash
cd packages/vscode-extension
npx @vscode/vsce publish          # publish current version
npx @vscode/vsce publish patch    # bump patch and publish (0.1.9 -> 0.1.10)
npx @vscode/vsce publish minor    # bump minor and publish (0.1.9 -> 0.2.0)
```

#### Publish a Pre-packaged VSIX

```bash
cd packages/vscode-extension
npx @vscode/vsce publish --packagePath any-sync-0.1.9.vsix
```

#### Unpublish

```bash
npx @vscode/vsce unpublish patrickw1029.any-sync
```

### OpenClaw Plugin

```bash
clawhub package publish ./packages/openclaw-plugin \
  --name any-sync \
  --family code-plugin \
  --source-repo imink/any-sync \
  --source-commit $(git rev-parse HEAD) \
  --source-ref main \
  --source-path packages/openclaw-plugin
```

## Code Conventions

- Prettier: semicolons, single quotes, 2-space indent, trailing commas, 100 char width
- TypeScript: strict mode, CommonJS output, ES2022 target
- CLI package: zero npm deps, Node.js built-ins only (`fs`, `path`, `crypto`, `child_process`, `os`)
- Config format: `.any-sync.json` with `mappings[]` array
- Lockfile: `.any-sync.lock` JSON with version 1, entries keyed by `mapping::relpath`

## License

MIT
