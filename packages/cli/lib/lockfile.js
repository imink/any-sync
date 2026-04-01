'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY_DATA = { version: 1, files: {}, lastSync: {} };

class Lockfile {
  constructor(filePath) {
    this._path = filePath;
    this._data = { ...EMPTY_DATA, files: {}, lastSync: {} };
  }

  static load(filePath) {
    const lf = new Lockfile(filePath);
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (raw.version === 1 && raw.files && raw.lastSync) {
          lf._data = raw;
        }
      } catch {
        // Invalid file — use empty data
      }
    }
    return lf;
  }

  save() {
    const tmp = this._path + '.' + crypto.randomUUID();
    fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this._path);
  }

  getEntry(key) {
    return this._data.files[key] || null;
  }

  setEntry(key, remoteSha, localHash) {
    this._data.files[key] = {
      remoteSha,
      localHash,
      syncedAt: new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z'),
    };
  }

  getEntriesForMapping(name) {
    const prefix = name + '::';
    const result = {};
    for (const [key, value] of Object.entries(this._data.files)) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = value;
      }
    }
    return result;
  }

  setLastSync(name) {
    this._data.lastSync[name] = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
  }

  getLastSync(name) {
    return this._data.lastSync[name] || null;
  }
}

function makeKey(mapping, relpath) {
  return mapping + '::' + relpath;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

module.exports = { Lockfile, makeKey, hashFile };
