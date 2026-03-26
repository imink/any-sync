import * as assert from 'assert';
import { SyncEngine } from '../../sync/syncEngine';

suite('SyncEngine - Include/Exclude Rules', () => {
  test('should not push config when include does not match', () => {
    const engine = Object.create(SyncEngine.prototype) as any;

    const shouldPush = engine.shouldPushPathForMapping(
      {
        name: 'mapping1',
        repo: 'o/r',
        sourcePath: 'src',
        destPath: 'dest',
        include: ['**/*.md'],
      },
      '.any-sync.json',
    );

    assert.strictEqual(shouldPush, false);
  });

  test('should not push config when exclude matches', () => {
    const engine = Object.create(SyncEngine.prototype) as any;

    const shouldPush = engine.shouldPushPathForMapping(
      {
        name: 'mapping1',
        repo: 'o/r',
        sourcePath: 'src',
        destPath: 'dest',
        exclude: ['**/*.json'],
      },
      '.any-sync.json',
    );

    assert.strictEqual(shouldPush, false);
  });

  test('should push config when included and not excluded', () => {
    const engine = Object.create(SyncEngine.prototype) as any;

    const shouldPush = engine.shouldPushPathForMapping(
      {
        name: 'mapping1',
        repo: 'o/r',
        sourcePath: 'src',
        destPath: 'dest',
        include: ['**/*.json'],
        exclude: ['tmp/**'],
      },
      '.any-sync.json',
    );

    assert.strictEqual(shouldPush, true);
  });
});
