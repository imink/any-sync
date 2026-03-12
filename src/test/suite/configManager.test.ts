import * as assert from 'assert';
import { validateConfig, SyncConfig } from '../../config/schema';

suite('Config Validation', () => {
  test('should accept a valid config', () => {
    const config: SyncConfig = {
      mappings: [
        {
          name: 'Test',
          repo: 'owner/repo',
          sourcePath: 'src',
          destPath: '.local/dest',
        },
      ],
    };
    const errors = validateConfig(config);
    assert.strictEqual(errors.length, 0);
  });

  test('should accept config with all optional fields', () => {
    const config = {
      mappings: [
        {
          name: 'Full Config',
          repo: 'owner/repo',
          branch: 'develop',
          sourcePath: 'skills',
          destPath: '.claude/skills',
          include: ['**/*.md'],
          exclude: ['**/draft-*'],
        },
      ],
    };
    const errors = validateConfig(config);
    assert.strictEqual(errors.length, 0);
  });

  test('should reject non-object config', () => {
    const errors = validateConfig('not an object');
    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('JSON object'));
  });

  test('should reject null config', () => {
    const errors = validateConfig(null);
    assert.ok(errors.length > 0);
  });

  test('should reject config without mappings', () => {
    const errors = validateConfig({});
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.path === 'mappings'));
  });

  test('should reject empty mappings array', () => {
    const errors = validateConfig({ mappings: [] });
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.message.includes('at least one')));
  });

  test('should reject mapping without required fields', () => {
    const errors = validateConfig({ mappings: [{}] });
    assert.ok(errors.length >= 4); // name, repo, sourcePath, destPath
  });

  test('should reject invalid repo format', () => {
    const errors = validateConfig({
      mappings: [
        {
          name: 'Test',
          repo: 'not-a-valid-repo',
          sourcePath: 'src',
          destPath: 'dest',
        },
      ],
    });
    assert.ok(errors.some((e) => e.path.includes('repo') && e.message.includes('owner/repo')));
  });

  test('should accept repos with dots and hyphens', () => {
    const errors = validateConfig({
      mappings: [
        {
          name: 'Test',
          repo: 'my-org.name/my-repo.name',
          sourcePath: 'src',
          destPath: 'dest',
        },
      ],
    });
    assert.strictEqual(errors.length, 0);
  });

  test('should reject unknown top-level properties', () => {
    const errors = validateConfig({
      mappings: [{ name: 'T', repo: 'o/r', sourcePath: 's', destPath: 'd' }],
      extraField: true,
    });
    assert.ok(errors.some((e) => e.message.includes('Unknown property')));
  });

  test('should reject unknown mapping properties', () => {
    const errors = validateConfig({
      mappings: [
        {
          name: 'Test',
          repo: 'o/r',
          sourcePath: 's',
          destPath: 'd',
          unknownProp: true,
        },
      ],
    });
    assert.ok(errors.some((e) => e.message.includes('Unknown property')));
  });

  test('should reject non-string include entries', () => {
    const errors = validateConfig({
      mappings: [
        {
          name: 'Test',
          repo: 'o/r',
          sourcePath: 's',
          destPath: 'd',
          include: [123],
        },
      ],
    });
    assert.ok(errors.some((e) => e.path.includes('include')));
  });

  test('should reject empty branch string', () => {
    const errors = validateConfig({
      mappings: [
        {
          name: 'Test',
          repo: 'o/r',
          sourcePath: 's',
          destPath: 'd',
          branch: '',
        },
      ],
    });
    assert.ok(errors.some((e) => e.path.includes('branch')));
  });

  test('should accept multiple mappings', () => {
    const config = {
      mappings: [
        { name: 'A', repo: 'o/r1', sourcePath: 'a', destPath: 'da' },
        { name: 'B', repo: 'o/r2', sourcePath: 'b', destPath: 'db' },
      ],
    };
    const errors = validateConfig(config);
    assert.strictEqual(errors.length, 0);
  });
});
