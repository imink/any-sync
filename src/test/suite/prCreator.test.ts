import * as assert from 'assert';
import { PrCreator } from '../../sync/prCreator';
import { PushableFile } from '../../sync/pushManager';

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

const mockGithubClient = {} as any;

suite('PrCreator - Body Generation', () => {
  let prCreator: PrCreator;

  setup(() => {
    prCreator = new PrCreator(mockGithubClient, mockOutputChannel);
  });

  test('should include mapping name in body', () => {
    const mapping = {
      name: 'My Skills',
      repo: 'o/r',
      sourcePath: 'skills',
      destPath: '.claude/skills',
    };
    const files: PushableFile[] = [
      { relativePath: 'file.md', localPath: '/tmp/file.md', content: Buffer.from('x') },
    ];

    const body = prCreator.generateBody(mapping, files);
    assert.ok(body.includes('My Skills'));
  });

  test('should list all changed files', () => {
    const mapping = {
      name: 'Test',
      repo: 'o/r',
      sourcePath: 'src',
      destPath: 'dest',
    };
    const files: PushableFile[] = [
      { relativePath: 'a.ts', localPath: '/tmp/a.ts', content: Buffer.from('a') },
      { relativePath: 'b.ts', localPath: '/tmp/b.ts', content: Buffer.from('b') },
      { relativePath: 'c.ts', localPath: '/tmp/c.ts', content: Buffer.from('c') },
    ];

    const body = prCreator.generateBody(mapping, files);
    assert.ok(body.includes('a.ts'));
    assert.ok(body.includes('b.ts'));
    assert.ok(body.includes('c.ts'));
  });

  test('should include file count', () => {
    const mapping = {
      name: 'Test',
      repo: 'o/r',
      sourcePath: 'src',
      destPath: 'dest',
    };
    const files: PushableFile[] = [
      { relativePath: 'a.ts', localPath: '/tmp/a.ts', content: Buffer.from('a') },
      { relativePath: 'b.ts', localPath: '/tmp/b.ts', content: Buffer.from('b') },
    ];

    const body = prCreator.generateBody(mapping, files);
    assert.ok(body.includes('2'));
  });

  test('should include source path', () => {
    const mapping = {
      name: 'Test',
      repo: 'o/r',
      sourcePath: 'my/special/path',
      destPath: 'dest',
    };
    const files: PushableFile[] = [
      { relativePath: 'f.ts', localPath: '/tmp/f.ts', content: Buffer.from('x') },
    ];

    const body = prCreator.generateBody(mapping, files);
    assert.ok(body.includes('my/special/path'));
  });
});
