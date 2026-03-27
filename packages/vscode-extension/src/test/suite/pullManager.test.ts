import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { PullManager } from '../../sync/pullManager';

const mockOutputChannel = {
  appendLine: (_msg: string) => {},
  append: (_msg: string) => {},
  clear: () => {},
  show: () => {},
  hide: () => {},
  dispose: () => {},
  name: 'test',
  replace: (_value: string) => {},
} as any;

suite('PullManager - Non-destructive Pull', () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'any-sync-pull-test-'));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('should mark untracked local/remote differences as conflict without overwrite', async () => {
    const githubClient = {
      getTree: async () => [{ path: 'notes.txt', sha: 'sha-remote', type: 'blob' }],
      getBlobsBatched: async () => new Map<string, Buffer>([['notes.txt', Buffer.from('remote')]]),
    };

    const lockfile = {
      isRemoteChanged: () => true,
      isLocallyModified: async () => false,
      getEntry: () => null,
      setEntry: () => {},
      setLastSync: () => {},
      save: async () => {},
    };

    const pullManager = new PullManager(githubClient as any, lockfile as any, mockOutputChannel);

    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    const localPath = path.join(destRoot, 'notes.txt');
    await fs.writeFile(localPath, 'local');

    const result = await pullManager.pull(
      {
        name: 'mapping1',
        repo: 'o/r',
        branch: 'main',
        sourcePath: 'src',
        destPath: 'dest',
      },
      destRoot,
    );

    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].status, 'conflict');

    const localAfterPull = await fs.readFile(localPath, 'utf8');
    assert.strictEqual(localAfterPull, 'local');
  });
});
