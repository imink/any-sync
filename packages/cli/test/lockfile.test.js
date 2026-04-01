#!/usr/bin/env node
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Lockfile, makeKey, hashFile } = require('../lib/lockfile');

describe('Lockfile', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), 'test-lockfile-' + Date.now() + '.json');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('initializes with empty data when file does not exist', () => {
    const lf = Lockfile.load(tmpFile);
    assert.strictEqual(lf.getEntry('foo'), null);
  });

  it('sets and gets entries', () => {
    const lf = Lockfile.load(tmpFile);
    lf.setEntry('mymap::file.md', 'abc123', 'def456');
    const entry = lf.getEntry('mymap::file.md');
    assert.strictEqual(entry.remoteSha, 'abc123');
    assert.strictEqual(entry.localHash, 'def456');
    assert.ok(entry.syncedAt);
  });

  it('saves and reloads', () => {
    const lf = Lockfile.load(tmpFile);
    lf.setEntry('mymap::file.md', 'abc123', 'def456');
    lf.save();

    const lf2 = Lockfile.load(tmpFile);
    const entry = lf2.getEntry('mymap::file.md');
    assert.strictEqual(entry.remoteSha, 'abc123');
    assert.strictEqual(entry.localHash, 'def456');
  });

  it('sets and gets lastSync', () => {
    const lf = Lockfile.load(tmpFile);
    lf.setLastSync('mymap');
    const ts = lf.getLastSync('mymap');
    assert.ok(ts);
    assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  });

  it('returns null for unknown lastSync', () => {
    const lf = Lockfile.load(tmpFile);
    assert.strictEqual(lf.getLastSync('nonexistent'), null);
  });

  it('gets entries for mapping', () => {
    const lf = Lockfile.load(tmpFile);
    lf.setEntry('mymap::file1.md', 'sha1', 'hash1');
    lf.setEntry('mymap::file2.md', 'sha2', 'hash2');
    lf.setEntry('other::file3.md', 'sha3', 'hash3');

    const entries = lf.getEntriesForMapping('mymap');
    assert.strictEqual(Object.keys(entries).length, 2);
    assert.ok(entries['file1.md']);
    assert.ok(entries['file2.md']);
    assert.strictEqual(entries['file3.md'], undefined);
  });
});

describe('makeKey', () => {
  it('creates mapping::relpath key', () => {
    assert.strictEqual(makeKey('mymap', 'path/to/file.md'), 'mymap::path/to/file.md');
  });
});

describe('hashFile', () => {
  it('computes SHA-256 hash', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-hash-' + Date.now());
    fs.writeFileSync(tmpFile, 'hello');
    try {
      const hash = hashFile(tmpFile);
      assert.strictEqual(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
