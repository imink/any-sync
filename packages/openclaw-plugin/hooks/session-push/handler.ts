import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sharedLib = require('../../../shared-scripts/lib') as {
  push: (configPath: string, lockfilePath: string) => { pushed: string[] };
  status: (configPath: string, lockfilePath: string) => {
    mappings: { changes: unknown[] }[];
  };
  findConfig: () => string | null;
  getAuthToken: () => string | null;
};

const handler = async (event: { type: string; messages: string[] }) => {
  const config = sharedLib.findConfig();
  if (!config) return;

  const token = sharedLib.getAuthToken();
  if (!token) return;

  try {
    const statusResult = sharedLib.status(config, '.any-sync.lock');
    const totalChanges =
      statusResult.mappings?.reduce(
        (sum: number, m: { changes: unknown[] }) => sum + (m.changes?.length ?? 0),
        0,
      ) ?? 0;

    if (totalChanges === 0) return;

    const pushResult = sharedLib.push(config, '.any-sync.lock');
    const pushCount = pushResult.pushed?.length ?? 0;
    if (pushCount > 0) {
      event.messages.push(`Any Sync: auto-pushed ${pushCount} file(s) to GitHub.`);
    }
  } catch {
    // Silent failure — don't block session end
  }
};

export default handler;
