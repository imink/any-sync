import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_SCRIPTS = resolve(__dirname, '..', '..', '..', 'shared-scripts');

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

const handler = async (event: { type: string; messages: string[] }) => {
  const config = findConfig();
  if (!config) return;

  const token = await getToken();
  if (!token) return;

  try {
    // Check if there are changes first
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

    if (totalChanges === 0) return;

    // Push changes
    const pushResult = await runScript(resolve(SHARED_SCRIPTS, 'any-sync-push.sh'), [
      config,
      '.any-sync.lock',
    ]);
    const parsed = JSON.parse(pushResult);
    const pushCount = parsed.pushed?.length ?? 0;
    if (pushCount > 0) {
      event.messages.push(`📤 Any Sync: auto-pushed ${pushCount} file(s) to GitHub.`);
    }
  } catch {
    // Silent failure — don't block session end
  }
};

export default handler;
