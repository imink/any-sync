'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getPresetMappings } = require('../lib/init');

describe('getPresetMappings', () => {
  it('returns 3 mappings for claude preset', () => {
    const mappings = getPresetMappings('claude');
    assert.ok(Array.isArray(mappings));
    assert.equal(mappings.length, 3);
    assert.equal(mappings[0].name, 'claude-skills');
    assert.equal(mappings[1].name, 'claude-memory');
    assert.equal(mappings[2].name, 'claude-settings');
    assert.equal(mappings[0].destPath, '~/.claude/skills');
  });

  it('returns 3 mappings for openclaw preset', () => {
    const mappings = getPresetMappings('openclaw');
    assert.ok(Array.isArray(mappings));
    assert.equal(mappings.length, 3);
    assert.equal(mappings[0].name, 'workspace-skills');
    assert.equal(mappings[1].name, 'workspace-memory');
    assert.equal(mappings[2].name, 'workspace-config');
  });

  it('returns null for unknown preset', () => {
    const mappings = getPresetMappings('unknown');
    assert.equal(mappings, null);
  });
});
