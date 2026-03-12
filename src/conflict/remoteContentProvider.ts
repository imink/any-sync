import * as vscode from 'vscode';

/**
 * URI scheme for remote content in diff views.
 */
export const REMOTE_CONTENT_SCHEME = 'github-sync-remote';

/**
 * Provides remote file content for VSCode's diff editor.
 *
 * Files are registered with a URI like:
 *   github-sync-remote:/<mapping-name>/<relative-path>
 *
 * The content is stored in-memory and can be set before opening a diff.
 */
export class RemoteContentProvider implements vscode.TextDocumentContentProvider {
  private _contentMap = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this._onDidChange.event;

  /**
   * Store remote content for a given URI.
   */
  setContent(uri: vscode.Uri, content: string): void {
    this._contentMap.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  /**
   * Build a URI for remote content.
   */
  static buildUri(mappingName: string, relativePath: string): vscode.Uri {
    return vscode.Uri.parse(
      `${REMOTE_CONTENT_SCHEME}:/${encodeURIComponent(mappingName)}/${relativePath}`,
    );
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._contentMap.get(uri.toString()) ?? '';
  }

  /**
   * Clear all stored content.
   */
  clear(): void {
    this._contentMap.clear();
  }

  /**
   * Remove content for a specific URI.
   */
  removeContent(uri: vscode.Uri): void {
    this._contentMap.delete(uri.toString());
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._contentMap.clear();
  }
}
