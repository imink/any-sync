import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sharedLib = require('../../shared-scripts/lib') as {
  pull: (configPath: string, lockfilePath: string) => { pulled: string[] };
  push: (configPath: string, lockfilePath: string) => { pushed: string[] };
  status: (configPath: string, lockfilePath: string) => {
    mappings: { changes: unknown[] }[];
  };
  findConfig: () => string | null;
  getAuthToken: () => string | null;
};

async function autoPull(): Promise<number> {
  const config = sharedLib.findConfig();
  if (!config) return 0;

  const token = sharedLib.getAuthToken();
  if (!token) return 0;

  const result = sharedLib.pull(config, '.any-sync.lock');
  return result.pulled?.length ?? 0;
}

async function autoPush(): Promise<number> {
  const config = sharedLib.findConfig();
  if (!config) return 0;

  const token = sharedLib.getAuthToken();
  if (!token) return 0;

  const statusResult = sharedLib.status(config, '.any-sync.lock');
  const totalChanges =
    statusResult.mappings?.reduce(
      (sum: number, m: { changes: unknown[] }) => sum + (m.changes?.length ?? 0),
      0,
    ) ?? 0;

  if (totalChanges === 0) return 0;

  const pushResult = sharedLib.push(config, '.any-sync.lock');
  return pushResult.pushed?.length ?? 0;
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
