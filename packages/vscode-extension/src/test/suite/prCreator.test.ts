import * as assert from 'assert';
import * as vscode from 'vscode';
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

  test('createPr should not block waiting for notification action', async () => {
    const originalShowInformationMessage = (vscode.window as any).showInformationMessage;

    let resolveNotification: ((value: string | undefined) => void) | undefined;
    const pendingNotification = new Promise<string | undefined>((resolve) => {
      resolveNotification = resolve;
    });

    (vscode.window as any).showInformationMessage = () => pendingNotification;

    const githubClient = {
      createPullRequest: async () => ({
        number: 1,
        html_url: 'https://github.com/o/r/pull/1',
      }),
    };

    const creator = new PrCreator(githubClient as any, mockOutputChannel);
    const mapping = {
      name: 'My Skills',
      repo: 'o/r',
      sourcePath: 'skills',
      destPath: '.claude/skills',
    };
    const files: PushableFile[] = [
      { relativePath: 'file.md', localPath: '/tmp/file.md', content: Buffer.from('x') },
    ];

    try {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('createPr timed out')), 250);
      });

      const result = await Promise.race([
        creator.createPr(mapping, 'any-sync/test-branch', files),
        timeout,
      ]);

      assert.strictEqual(result.number, 1);
      assert.strictEqual(result.url, 'https://github.com/o/r/pull/1');
    } finally {
      if (resolveNotification) {
        resolveNotification(undefined);
      }
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    }
  });
});
