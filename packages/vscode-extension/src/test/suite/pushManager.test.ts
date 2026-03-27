import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { Lockfile, hashContent } from '../../sync/lockfile';
import { PushManager } from '../../sync/pushManager';

// Create a minimal mock output channel
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

suite('PushManager - Change Detection', () => {
  let tmpDir: string;
  let lockfile: Lockfile;
  let pushManager: PushManager;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'any-sync-push-test-'));
    lockfile = new Lockfile(tmpDir);
    pushManager = new PushManager(lockfile, mockOutputChannel);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('should detect modified files', async () => {
    const originalContent = Buffer.from('original');
    lockfile.setEntry('mapping1', 'file.txt', 'sha123', originalContent);

    // Write a modified local file
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'file.txt'), 'modified content');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'file.txt');
  });

  test('should not detect unmodified files', async () => {
    const content = Buffer.from('same content');
    lockfile.setEntry('mapping1', 'file.txt', 'sha123', content);

    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'file.txt'), content);

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 0);
  });

  test('should detect new files not in lockfile', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'new-file.txt'), 'new content');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'new-file.txt');
  });

  test('should skip hidden files in new file detection', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, '.hidden'), 'hidden content');
    await fs.writeFile(path.join(destRoot, 'visible.txt'), 'visible content');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'visible.txt');
  });

  test('should detect files in subdirectories', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(path.join(destRoot, 'sub', 'dir'), { recursive: true });
    await fs.writeFile(path.join(destRoot, 'sub', 'dir', 'deep.txt'), 'deep content');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.ok(changes[0].relativePath.includes('deep.txt'));
  });

  test('should handle empty dest directory', async () => {
    const destRoot = path.join(tmpDir, 'empty-dest');
    await fs.mkdir(destRoot, { recursive: true });

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 0);
  });

  test('should handle nonexistent dest directory', async () => {
    const destRoot = path.join(tmpDir, 'nonexistent');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 0);
  });

  test('should apply include filter to detected changes', async () => {
    const original = Buffer.from('original');
    lockfile.setEntry('mapping1', 'doc.md', 'sha1', original);
    lockfile.setEntry('mapping1', 'code.ts', 'sha2', original);

    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'doc.md'), 'modified');
    await fs.writeFile(path.join(destRoot, 'code.ts'), 'modified');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest', include: ['**/*.md'] },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'doc.md');
  });

  test('should apply exclude filter to detected changes', async () => {
    const original = Buffer.from('original');
    lockfile.setEntry('mapping1', 'keep.md', 'sha1', original);
    lockfile.setEntry('mapping1', 'drafts/wip.md', 'sha2', original);

    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(path.join(destRoot, 'drafts'), { recursive: true });
    await fs.writeFile(path.join(destRoot, 'keep.md'), 'modified');
    await fs.writeFile(path.join(destRoot, 'drafts', 'wip.md'), 'modified');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest', exclude: ['drafts/**'] },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'keep.md');
  });

  test('should apply include filter to new (untracked) files', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'readme.md'), 'new');
    await fs.writeFile(path.join(destRoot, 'script.sh'), 'new');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest', include: ['**/*.md'] },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'readme.md');
  });

  test('should apply exclude filter to new (untracked) files', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(path.join(destRoot, 'tmp'), { recursive: true });
    await fs.writeFile(path.join(destRoot, 'good.md'), 'new');
    await fs.writeFile(path.join(destRoot, 'tmp', 'scratch.md'), 'new');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest', exclude: ['tmp/**'] },
      destRoot,
    );

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].relativePath, 'good.md');
  });

  test('should include all files when no include/exclude specified', async () => {
    const destRoot = path.join(tmpDir, 'dest');
    await fs.mkdir(destRoot, { recursive: true });
    await fs.writeFile(path.join(destRoot, 'a.md'), 'new');
    await fs.writeFile(path.join(destRoot, 'b.ts'), 'new');
    await fs.writeFile(path.join(destRoot, 'c.txt'), 'new');

    const changes = await pushManager.detectChanges(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      destRoot,
    );

    assert.strictEqual(changes.length, 3);
  });

  test('should prefer explicit repoPath when provided', () => {
    const repoPath = pushManager.toRepoRelativePath(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'src', destPath: 'dest' },
      {
        relativePath: '.any-sync.json',
        repoPath: '.any-sync.json',
        localPath: '/tmp/.any-sync.json',
        content: Buffer.from('{}'),
      },
    );

    assert.strictEqual(repoPath, '.any-sync.json');
  });

  test('should resolve mapping-relative path when repoPath is missing', () => {
    const repoPath = pushManager.toRepoRelativePath(
      { name: 'mapping1', repo: 'o/r', sourcePath: 'skills', destPath: 'dest' },
      {
        relativePath: 'a.md',
        localPath: '/tmp/a.md',
        content: Buffer.from('x'),
      },
    );

    assert.strictEqual(repoPath, 'skills/a.md');
  });
});
