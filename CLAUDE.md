# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Any Sync — a cross-tool bidirectional sync system that syncs files between GitHub repos and local directories. Supports VS Code, Claude Code, and OpenClaw via a shared config format (`.any-sync.json`), lockfile (`.any-sync.lock`), and core shell scripts.

## Monorepo Structure (npm workspaces)

```
packages/
  vscode-extension/   — TypeScript VS Code extension (esbuild-bundled, Octokit + simple-git)
  claude-plugin/      — Shell-based Claude Code plugin (SKILL.md slash commands + session hooks)
  openclaw-plugin/    — OpenClaw plugin (TypeScript entry + shell skills/hooks)
  shared-scripts/     — Core bash scripts shared by claude-plugin and openclaw-plugin
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

**Shared scripts** (`packages/shared-scripts/`): The core sync engine used by Claude and OpenClaw plugins. Each script is standalone bash:
- `any-sync-pull.sh` — GitHub Tree API fetch, conflict detection, base64 blob download, lockfile update
- `any-sync-push.sh` — Detect local changes, create git tree/commit/ref via GitHub API
- `any-sync-lockfile.sh` — Lockfile CRUD, SHA-256 hashing, `gh_api_retry` with exponential backoff
- `any-sync-auth.sh` — Auth via `GITHUB_TOKEN` env var or `gh auth token`
- `any-sync-status.sh` / `any-sync-reset.sh`

**VS Code extension** (`packages/vscode-extension/`): Independent TypeScript implementation (does NOT use shared scripts). Key classes:
- `SyncEngine` orchestrates pull/push with progress/cancellation
- `PullManager` / `PushManager` handle GitHub API interactions
- `ConfigManager` handles `.any-sync.json` with `${copilotMemory}` token expansion
- `ConflictResolver` provides side-by-side diff view
- Entry point: `src/extension.ts` → bundled to `out/extension.js` via esbuild

**Claude plugin** (`packages/claude-plugin/`): No Node.js runtime needed. Skills are SKILL.md files that instruct Claude to run the shared bash scripts. Session hooks auto-pull on start, auto-push on end. Cross-platform hook wrapper (`run-hook.cmd`) is a bash/cmd polyglot.

**OpenClaw plugin** (`packages/openclaw-plugin/`): TypeScript entry (`src/index.ts`) registers hooks via the OpenClaw API. Also has SKILL.md skills and shell scripts. Profile-aware via `OPENCLAW_PROFILE`.

## Key Conventions

- Prettier: semicolons, single quotes, 2-space indent, trailing commas, 100 char width
- TypeScript: strict mode, CommonJS output, ES2022 target
- Config format: `.any-sync.json` with `mappings[]` array (name, repo, branch, sourcePath, destPath, include, exclude)
- Lockfile: `.any-sync.lock` JSON with version 1, entries keyed by relative path containing `remoteSha`, `localHash` (SHA-256), `syncedAt`

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
