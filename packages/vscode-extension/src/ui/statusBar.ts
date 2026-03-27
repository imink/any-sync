import * as vscode from 'vscode';

export type SyncState = 'idle' | 'syncing' | 'error' | 'success';

/**
 * Manages the status bar item for Any Sync.
 */
export class StatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(private readonly outputChannel: vscode.OutputChannel) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'any-sync.showOutput';
    this.setState('idle');
    this.statusBarItem.show();
  }

  /**
   * Update the status bar state.
   */
  setState(state: SyncState, message?: string): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    switch (state) {
      case 'idle':
        this.statusBarItem.text = '$(cloud) Any Sync';
        this.statusBarItem.tooltip = 'Any Sync: Ready';
        this.statusBarItem.backgroundColor = undefined;
        break;

      case 'syncing':
        this.statusBarItem.text = '$(sync~spin) Any Sync';
        this.statusBarItem.tooltip = `Any Sync: ${message || 'Syncing...'}`;
        this.statusBarItem.backgroundColor = undefined;
        break;

      case 'success':
        this.statusBarItem.text = '$(check) Any Sync';
        this.statusBarItem.tooltip = `Any Sync: ${message || 'Sync complete'}`;
        this.statusBarItem.backgroundColor = undefined;
        // Auto-reset to idle after 5 seconds
        this.resetTimer = setTimeout(() => this.setState('idle'), 5000);
        break;

      case 'error':
        this.statusBarItem.text = '$(error) Any Sync';
        this.statusBarItem.tooltip = `Any Sync: ${message || 'Error'}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
        // Auto-reset to idle after 10 seconds
        this.resetTimer = setTimeout(() => this.setState('idle'), 10000);
        break;
    }
  }

  dispose(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.statusBarItem.dispose();
  }
}
