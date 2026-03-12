import * as vscode from 'vscode';

/**
 * Wraps VSCode's progress API for sync operations.
 */
export class ProgressReporter {
  /**
   * Run an async operation with a progress notification.
   */
  static async withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      task,
    );
  }
}
