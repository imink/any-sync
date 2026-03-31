import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_SCRIPTS = resolve(__dirname, '..', '..', 'shared-scripts');

function findConfig(): string | null {
  const homeConfig = resolve(homedir(), '.any-sync.json');
  if (existsSync(homeConfig)) return homeConfig;
  const localConfig = resolve(process.cwd(), '.any-sync.json');
  if (existsSync(localConfig)) return localConfig;
  return null;
}

function getToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return Promise.resolve(process.env.GITHUB_TOKEN);
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      resolve(stdout.trim());
    });
  });
}

function runScript(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('bash', [script, ...args], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function autoPull(): Promise<number> {
  const config = findConfig();
  if (!config) return 0;

  const token = await getToken();
  if (!token) return 0;

  const result = await runScript(resolve(SHARED_SCRIPTS, 'any-sync-pull.sh'), [
    config,
    '.any-sync.lock',
  ]);
  const parsed = JSON.parse(result);
  return parsed.pulled?.length ?? 0;
}

async function autoPush(): Promise<number> {
  const config = findConfig();
  if (!config) return 0;

  const token = await getToken();
  if (!token) return 0;

  // Check for changes first
  const statusResult = await runScript(resolve(SHARED_SCRIPTS, 'any-sync-status.sh'), [
    config,
    '.any-sync.lock',
  ]);
  const status = JSON.parse(statusResult);
  const totalChanges =
    status.mappings?.reduce(
      (sum: number, m: { changes: unknown[] }) => sum + (m.changes?.length ?? 0),
      0,
    ) ?? 0;

  if (totalChanges === 0) return 0;

  const pushResult = await runScript(resolve(SHARED_SCRIPTS, 'any-sync-push.sh'), [
    config,
    '.any-sync.lock',
  ]);
  const parsed = JSON.parse(pushResult);
  return parsed.pushed?.length ?? 0;
}

/**
 * OpenClaw plugin entry point for Any Sync.
 *
 * Registers session lifecycle hooks for auto-pull on session start
 * and auto-push on session end. Skills are loaded from the skills/
 * directory as declared in openclaw.plugin.json.
 */
const plugin = {
  id: 'any-sync',
  name: 'Any Sync',
  description: 'Cross-device sync for OpenClaw workspace (skills, memory, settings) via GitHub',
  register(api: {
    registerHook: (name: string, hook: Record<string, unknown>) => void;
    pluginConfig: Record<string, unknown>;
    logger: { info: (msg: string) => void; error: (msg: string) => void };
  }) {
    const autoSync = api.pluginConfig?.autoSync !== false;

    if (autoSync) {
      api.registerHook('session_start', {
        handler: async () => {
          try {
            const count = await autoPull();
            if (count > 0) {
              api.logger.info(`Any Sync: auto-pulled ${count} file(s) from GitHub`);
            }
          } catch {
            // Silent failure
          }
        },
      });

      api.registerHook('session_end', {
        handler: async () => {
          try {
            const count = await autoPush();
            if (count > 0) {
              api.logger.info(`Any Sync: auto-pushed ${count} file(s) to GitHub`);
            }
          } catch {
            // Silent failure
          }
        },
      });
    }
  },
};

export default plugin;
