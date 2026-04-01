import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sharedLib = require('../../../shared-scripts/lib') as {
  pull: (configPath: string, lockfilePath: string) => { pulled: string[] };
  findConfig: () => string | null;
  getAuthToken: () => string | null;
};

const handler = async (event: { type: string; messages: string[] }) => {
  const config = sharedLib.findConfig();
  if (!config) return;

  const token = sharedLib.getAuthToken();
  if (!token) return;

  try {
    const result = sharedLib.pull(config, '.any-sync.lock');
    const pullCount = result.pulled?.length ?? 0;
    if (pullCount > 0) {
      event.messages.push(`Any Sync: auto-pulled ${pullCount} file(s) from GitHub.`);
    }
  } catch {
    // Silent failure — don't block session start
  }
};

export default handler;
