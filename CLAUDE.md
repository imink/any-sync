# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Any Sync — a cross-tool bidirectional sync system that syncs files between GitHub repos and local directories. Supports VS Code, Claude Code, and OpenClaw via a shared config format (`.any-sync.json`), lockfile (`.any-sync.lock`), and the `@any-sync/cli` core library.

## Monorepo Structure (npm workspaces)

```
packages/
  vscode-extension/   — TypeScript VS Code extension (esbuild-bundled, Octokit + simple-git)
  claude-plugin/      — Claude Code plugin (SKILL.md slash commands + JS session hooks, uses npx any-sync)
  openclaw-plugin/    — OpenClaw plugin (TypeScript entry + JS skills/hooks, uses @any-sync/cli)
  cli/                — Core JS sync library + CLI (any-sync pull/push/status/reset/auth/init)
```

## Build & Development Commands

```bash
npm install              # Install all workspace dependencies
npm run build            # Build VS Code extension (esbuild)
npm run watch            # Watch mode for VS Code extension
npm run test             # Run VS Code extension tests (Mocha via @vscode/test-electron)
npm run test:all         # Run tests across all workspaces
npm run lint             # ESLint on VS Code extension src/
npm run package          # Bundle VS Code extension into .vsix
```

## Architecture

**CLI** (`packages/cli/`): The core sync engine and CLI (`@any-sync/cli`, JavaScript, zero npm deps). Library modules in `lib/`, unified CLI in `bin/cli.js`, legacy bin scripts in `bin/`, tests in `test/`:
- `lib/pull.js` — GitHub Tree API fetch, conflict detection, base64 blob download, lockfile update
- `lib/push.js` — Detect local changes, create git tree/commit/ref via GitHub API
- `lib/lockfile.js` — Lockfile class (load/save/get/set), SHA-256 hashing
- `lib/gh.js` — `gh` CLI wrapper with `ghApiRetry` (exponential backoff)
- `lib/auth.js` — Auth via `GITHUB_TOKEN` env var or `gh auth token`
- `lib/config.js` — Config loading, validation, tilde expansion
- `lib/glob.js` — Inline glob matching (`*`, `**`, `?`)
- `lib/init.js` — Config creation + `getPresetMappings('claude'|'openclaw')`
- `lib/hooks.js` — `autoPull()` / `autoPush()` helpers (findConfig + auth guard + execute)
- `lib/status.js` / `lib/reset.js`
- `bin/cli.js` — Unified CLI dispatcher (`any-sync <command> [args]`)

**VS Code extension** (`packages/vscode-extension/`): Independent TypeScript implementation (does NOT use the CLI package). Key classes:
- `SyncEngine` orchestrates pull/push with progress/cancellation
- `PullManager` / `PushManager` handle GitHub API interactions
- `ConfigManager` handles `.any-sync.json` with `${copilotMemory}` token expansion
- `ConflictResolver` provides side-by-side diff view
- Entry point: `src/extension.ts` → bundled to `out/extension.js` via esbuild

**Claude plugin** (`packages/claude-plugin/`): Skills are SKILL.md files that instruct Claude to run `npx any-sync <command>`. Session hooks (`hooks/session-start.js`, `hooks/session-end.js`) auto-pull on start, auto-push on end via `npx any-sync`.

**OpenClaw plugin** (`packages/openclaw-plugin/`): TypeScript entry (`src/index.ts`) imports `@any-sync/cli` via `createRequire`. Uses `autoPull()`/`autoPush()` helpers. Also has SKILL.md skills and TypeScript hooks. Profile-aware via `OPENCLAW_PROFILE`.

## Key Conventions

- Prettier: semicolons, single quotes, 2-space indent, trailing commas, 100 char width
- TypeScript: strict mode, CommonJS output, ES2022 target
- CLI package: zero npm deps, Node.js built-ins only (`fs`, `path`, `crypto`, `child_process`, `os`)
- Config format: `.any-sync.json` with `mappings[]` array (name, repo, branch, sourcePath, destPath, include, exclude)
- Lockfile: `.any-sync.lock` JSON with version 1, entries keyed by `mapping::relpath` containing `remoteSha`, `localHash` (SHA-256), `syncedAt`

## Prerequisites

- **Node.js** (v18+) — script runtime
- **`gh` CLI** — GitHub API calls and authentication
- **npm** — workspace dependency management

## Plugin Installation (for testing)

Claude Code plugin:
```bash
# From CLI (one-time marketplace registration)
claude plugin marketplace add /absolute/path/to/packages/claude-plugin/.claude-plugin/marketplace.json
claude plugin install any-sync@any-sync-marketplace

# Or load for a single session
claude --plugin-dir ./packages/claude-plugin
```

VS Code extension: press F5 in VS Code to launch Extension Development Host.
