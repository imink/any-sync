#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { globMatch, matchesAny } = require('../lib/glob');

describe('globMatch', () => {
  it('matches simple extension pattern', () => {
    assert.ok(globMatch('*.md', 'readme.md'));
    assert.ok(globMatch('*.md', 'CHANGELOG.md'));
    assert.ok(!globMatch('*.md', 'readme.txt'));
    assert.ok(!globMatch('*.md', 'dir/readme.md')); // * does not cross /
  });

  it('matches ** for any depth', () => {
    assert.ok(globMatch('**/*.md', 'readme.md'));
    assert.ok(globMatch('**/*.md', 'dir/readme.md'));
    assert.ok(globMatch('**/*.md', 'a/b/c/readme.md'));
    assert.ok(!globMatch('**/*.md', 'readme.txt'));
  });

  it('matches ** at end', () => {
    assert.ok(globMatch('dir/**', 'dir/file.md'));
    assert.ok(globMatch('dir/**', 'dir/sub/file.md'));
  });

  it('matches exact file name', () => {
    assert.ok(globMatch('settings.json', 'settings.json'));
    assert.ok(!globMatch('settings.json', 'other.json'));
    assert.ok(!globMatch('settings.json', 'dir/settings.json'));
  });

  it('matches ? for single character', () => {
    assert.ok(globMatch('file?.md', 'file1.md'));
    assert.ok(globMatch('file?.md', 'fileA.md'));
    assert.ok(!globMatch('file?.md', 'file12.md'));
    assert.ok(!globMatch('file?.md', 'file.md'));
  });

  it('matches **/drafts/**', () => {
    assert.ok(globMatch('**/drafts/**', 'drafts/file.md'));
    assert.ok(globMatch('**/drafts/**', 'a/drafts/file.md'));
    assert.ok(globMatch('**/drafts/**', 'a/drafts/b/file.md'));
    assert.ok(!globMatch('**/drafts/**', 'nodrafts/file.md'));
  });

  it('handles patterns with dots correctly', () => {
    assert.ok(globMatch('*.json', 'package.json'));
    assert.ok(!globMatch('*.json', 'packageXjson'));
  });
});

describe('matchesAny', () => {
  it('returns true if any pattern matches', () => {
    assert.ok(matchesAny(['*.md', '*.txt'], 'readme.md'));
    assert.ok(matchesAny(['*.md', '*.txt'], 'notes.txt'));
    assert.ok(!matchesAny(['*.md', '*.txt'], 'file.json'));
  });

  it('returns false for empty patterns', () => {
    assert.ok(!matchesAny([], 'anything'));
  });
});
