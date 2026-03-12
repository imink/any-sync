import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('GitHub Sync');

  // Register commands - implementations will be added in later steps
  const pullCommand = vscode.commands.registerCommand('github-sync.pull', async () => {
    vscode.window.showInformationMessage('GitHub Sync: Pull not yet implemented');
  });

  const pushCommand = vscode.commands.registerCommand('github-sync.push', async () => {
    vscode.window.showInformationMessage('GitHub Sync: Push not yet implemented');
  });

  const pullSelectCommand = vscode.commands.registerCommand('github-sync.pullSelect', async () => {
    vscode.window.showInformationMessage('GitHub Sync: Pull (Select) not yet implemented');
  });

  const pushSelectCommand = vscode.commands.registerCommand('github-sync.pushSelect', async () => {
    vscode.window.showInformationMessage('GitHub Sync: Push (Select) not yet implemented');
  });

  const initConfigCommand = vscode.commands.registerCommand('github-sync.initConfig', async () => {
    vscode.window.showInformationMessage('GitHub Sync: Init Config not yet implemented');
  });

  context.subscriptions.push(
    outputChannel,
    pullCommand,
    pushCommand,
    pullSelectCommand,
    pushSelectCommand,
    initConfigCommand,
  );

  outputChannel.appendLine('GitHub Sync extension activated');
}

export function deactivate(): void {
  // Cleanup
}
