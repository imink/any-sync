import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { Lockfile, hashContent } from '../../sync/lockfile';

suite('Lockfile', () => {
  let tmpDir: string;
  let lockfile: Lockfile;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-sync-test-'));
    lockfile = new Lockfile(tmpDir);
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('hashContent should produce consistent hashes', () => {
    const content = Buffer.from('hello world');
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64); // SHA256 hex is 64 chars
  });

  test('hashContent should produce different hashes for different content', () => {
    const hash1 = hashContent(Buffer.from('hello'));
    const hash2 = hashContent(Buffer.from('world'));
    assert.notStrictEqual(hash1, hash2);
  });

  test('should start with empty data', () => {
    assert.strictEqual(lockfile.getEntry('mapping', 'file.txt'), null);
    assert.strictEqual(lockfile.getLastSync('mapping'), null);
  });

  test('should set and get entries', () => {
    const content = Buffer.from('test content');
    lockfile.setEntry('mapping1', 'file.txt', 'abc123', content);

    const entry = lockfile.getEntry('mapping1', 'file.txt');
    assert.ok(entry);
    assert.strictEqual(entry.remoteSha, 'abc123');
    assert.strictEqual(entry.localHash, hashContent(content));
    assert.ok(entry.syncedAt);
  });

  test('should isolate entries by mapping name', () => {
    lockfile.setEntry('mapping1', 'file.txt', 'sha1', Buffer.from('a'));
    lockfile.setEntry('mapping2', 'file.txt', 'sha2', Buffer.from('b'));

    const entry1 = lockfile.getEntry('mapping1', 'file.txt');
    const entry2 = lockfile.getEntry('mapping2', 'file.txt');

    assert.strictEqual(entry1?.remoteSha, 'sha1');
    assert.strictEqual(entry2?.remoteSha, 'sha2');
  });

  test('should remove entries', () => {
    lockfile.setEntry('mapping1', 'file.txt', 'sha', Buffer.from('x'));
    assert.ok(lockfile.getEntry('mapping1', 'file.txt'));

    lockfile.removeEntry('mapping1', 'file.txt');
    assert.strictEqual(lockfile.getEntry('mapping1', 'file.txt'), null);
  });

  test('should get entries for a specific mapping', () => {
    lockfile.setEntry('m1', 'a.txt', 'sha1', Buffer.from('a'));
    lockfile.setEntry('m1', 'b.txt', 'sha2', Buffer.from('b'));
    lockfile.setEntry('m2', 'c.txt', 'sha3', Buffer.from('c'));

    const m1Entries = lockfile.getEntriesForMapping('m1');
    assert.strictEqual(m1Entries.size, 2);
    assert.ok(m1Entries.has('a.txt'));
    assert.ok(m1Entries.has('b.txt'));

    const m2Entries = lockfile.getEntriesForMapping('m2');
    assert.strictEqual(m2Entries.size, 1);
    assert.ok(m2Entries.has('c.txt'));
  });

  test('should save and load lockfile', async () => {
    lockfile.setEntry('m1', 'file.txt', 'sha123', Buffer.from('content'));
    lockfile.setLastSync('m1');
    await lockfile.save();

    // Create new lockfile instance and load
    const lockfile2 = new Lockfile(tmpDir);
    await lockfile2.load();

    const entry = lockfile2.getEntry('m1', 'file.txt');
    assert.ok(entry);
    assert.strictEqual(entry.remoteSha, 'sha123');
    assert.ok(lockfile2.getLastSync('m1'));
  });

  test('should handle loading nonexistent lockfile gracefully', async () => {
    await lockfile.load(); // Should not throw
    assert.strictEqual(lockfile.getEntry('m', 'f'), null);
  });

  test('isRemoteChanged should detect changes', () => {
    lockfile.setEntry('m', 'f.txt', 'oldsha', Buffer.from('x'));

    assert.strictEqual(lockfile.isRemoteChanged('m', 'f.txt', 'oldsha'), false);
    assert.strictEqual(lockfile.isRemoteChanged('m', 'f.txt', 'newsha'), true);
  });

  test('isRemoteChanged should treat never-synced files as changed', () => {
    assert.strictEqual(lockfile.isRemoteChanged('m', 'new.txt', 'anysha'), true);
  });

  test('isLocallyModified should detect modified files', async () => {
    const originalContent = Buffer.from('original');
    lockfile.setEntry('m', 'f.txt', 'sha', originalContent);

    // Write a modified file
    const filePath = path.join(tmpDir, 'f.txt');
    await fs.writeFile(filePath, 'modified');

    const modified = await lockfile.isLocallyModified('m', 'f.txt', filePath);
    assert.strictEqual(modified, true);
  });

  test('isLocallyModified should return false for unmodified files', async () => {
    const content = Buffer.from('original');
    lockfile.setEntry('m', 'f.txt', 'sha', content);

    const filePath = path.join(tmpDir, 'f.txt');
    await fs.writeFile(filePath, content);

    const modified = await lockfile.isLocallyModified('m', 'f.txt', filePath);
    assert.strictEqual(modified, false);
  });

  test('isLocallyModified should return false for never-synced files', async () => {
    const modified = await lockfile.isLocallyModified('m', 'new.txt', '/nonexistent');
    assert.strictEqual(modified, false);
  });

  test('should track last sync per mapping', () => {
    assert.strictEqual(lockfile.getLastSync('m1'), null);

    lockfile.setLastSync('m1');
    const ts = lockfile.getLastSync('m1');
    assert.ok(ts);
    assert.ok(ts instanceof Date);
  });
});
