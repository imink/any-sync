import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { AuthManager } from './github/authManager';
import { GitHubClient } from './github/githubClient';
import { SyncEngine } from './sync/syncEngine';
import { pickMappings } from './ui/quickPick';
import { StatusBar } from './ui/statusBar';

let syncEngine: SyncEngine | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Any Sync');
  outputChannel.appendLine('Any Sync extension activating...');

  const statusBar = new StatusBar(outputChannel);

  // Initialize core services
  const configManager = new ConfigManager();
  const authManager = new AuthManager(outputChannel);
  const githubClient = new GitHubClient(authManager, outputChannel);

  // Initialize config
  configManager.initialize().catch((err) => {
    outputChannel.appendLine(`Any Sync: Config initialization error: ${err}`);
  });

  // Create sync engine (only if workspace is open)
  try {
    syncEngine = new SyncEngine(configManager, authManager, githubClient, outputChannel);
  } catch (err) {
    outputChannel.appendLine(`Any Sync: Could not create SyncEngine: ${err}`);
  }

  // Register commands
  const initConfigCommand = vscode.commands.registerCommand('any-sync.initConfig', async () => {
    await configManager.initConfig();
  });

  const pullCommand = vscode.commands.registerCommand('any-sync.pull', async () => {
    if (!syncEngine) {
      vscode.window.showErrorMessage('Any Sync: No workspace folder open.');
      return;
    }
    await syncEngine.pullAll();
  });

  const pullSelectCommand = vscode.commands.registerCommand('any-sync.pullSelect', async () => {
    if (!syncEngine) {
      vscode.window.showErrorMessage('Any Sync: No workspace folder open.');
      return;
    }
    const selected = await pickMappings(configManager.mappings, 'pull');
    if (selected) {
      await syncEngine.pullMappings(selected);
    }
  });

  const pushCommand = vscode.commands.registerCommand('any-sync.push', async () => {
    if (!syncEngine) {
      vscode.window.showErrorMessage('Any Sync: No workspace folder open.');
      return;
    }
    await syncEngine.pushAll();
  });

  const pushSelectCommand = vscode.commands.registerCommand('any-sync.pushSelect', async () => {
    if (!syncEngine) {
      vscode.window.showErrorMessage('Any Sync: No workspace folder open.');
      return;
    }
    const selected = await pickMappings(configManager.mappings, 'push');
    if (selected) {
      await syncEngine.pushMappings(selected);
    }
  });

  const showOutputCommand = vscode.commands.registerCommand('any-sync.showOutput', () => {
    outputChannel.show();
  });

  context.subscriptions.push(
    outputChannel,
    statusBar,
    configManager,
    authManager,
    githubClient,
    initConfigCommand,
    pullCommand,
    pullSelectCommand,
    pushCommand,
    pushSelectCommand,
    showOutputCommand,
  );

  if (syncEngine) {
    context.subscriptions.push(syncEngine);
  }

  outputChannel.appendLine('Any Sync extension activated');
}

export function deactivate(): void {
  syncEngine = undefined;
}
