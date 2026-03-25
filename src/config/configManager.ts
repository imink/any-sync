import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { SyncConfig, SyncMapping, ValidationError, validateConfig } from './schema';

export const CONFIG_FILENAME = '.any-sync.json';

const DEFAULT_CONFIG: SyncConfig = {
  mappings: [
    {
      name: 'Example: Claude Skills',
      repo: 'owner/repo',
      branch: 'main',
      sourcePath: 'skills',
      destPath: '.claude/skills',
      include: ['**/*.md'],
      exclude: [],
    },
    {
      name: 'Example: Claude Folder',
      repo: 'owner/repo',
      branch: 'main',
      sourcePath: '.claude',
      destPath: '.claude',
      include: ['**/*'],
      exclude: [],
    },
    {
      name: 'Example: VS Code Copilot Memory',
      repo: 'owner/repo',
      branch: 'main',
      sourcePath: 'copilot-memory',
      destPath: '${copilotMemory}',
      include: ['**/*'],
      exclude: [],
    },
  ],
};

export class ConfigManager implements vscode.Disposable {
  private _config: SyncConfig | null = null;
  private _diagnosticCollection: vscode.DiagnosticCollection;
  private _watchFilePath: string | null = null;
  private _onDidChangeConfig = new vscode.EventEmitter<SyncConfig | null>();

  /** Fires when the config file changes (or is deleted). Payload is the new config or null. */
  public readonly onDidChangeConfig = this._onDidChangeConfig.event;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this._diagnosticCollection = vscode.languages.createDiagnosticCollection('any-sync');
  }

  /**
   * Initialize the config manager: read config, set up watcher.
   */
  async initialize(): Promise<void> {
    await this.migrateLegacyConfigIfNeeded();
    await this.loadConfig();
    this.setupWatcher();
  }

  /**
   * Get the current parsed config, or null if no valid config exists.
   */
  get config(): SyncConfig | null {
    return this._config;
  }

  /**
   * Get all sync mappings from the current config.
   */
  get mappings(): SyncMapping[] {
    return this._config?.mappings ?? [];
  }

  /**
   * Get the config file URI for the current workspace.
   * Local config is stored in extension global storage so Git never tracks it.
   */
  private getConfigUri(): vscode.Uri | null {
    const workspaceFolder = this.getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      return null;
    }

    const workspaceKey = this.getWorkspaceStorageKey(workspaceFolder.uri);
    return vscode.Uri.joinPath(
      this.extensionContext.globalStorageUri,
      'workspaces',
      workspaceKey,
      CONFIG_FILENAME,
    );
  }

  /**
   * Legacy config location in workspace root.
   */
  private getLegacyConfigUri(): vscode.Uri | null {
    const workspaceFolder = this.getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      return null;
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_FILENAME);
  }

  /**
   * Load and validate the config from disk.
   */
  async loadConfig(): Promise<SyncConfig | null> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      this._config = null;
      this._onDidChangeConfig.fire(null);
      return null;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(configUri);
      const text = Buffer.from(raw).toString('utf8');
      const parsed = JSON.parse(text);

      const errors = validateConfig(parsed);
      this.updateDiagnostics(configUri, text, errors);

      if (errors.length > 0) {
        this._config = null;
        this._onDidChangeConfig.fire(null);
        return null;
      }

      this._config = parsed as SyncConfig;
      this._onDidChangeConfig.fire(this._config);
      return this._config;
    } catch (err) {
      if (err instanceof SyntaxError) {
        // JSON parse error
        if (configUri) {
          this._diagnosticCollection.set(configUri, [
            new vscode.Diagnostic(
              new vscode.Range(0, 0, 0, 0),
              `Invalid JSON: ${err.message}`,
              vscode.DiagnosticSeverity.Error,
            ),
          ]);
        }
      }
      // File not found or other error — no config
      this._config = null;
      this._onDidChangeConfig.fire(null);
      return null;
    }
  }

  /**
  * Read raw config file bytes from local storage.
   */
  async readConfigFileRaw(): Promise<Buffer | null> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      return null;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(configUri);
      return Buffer.from(raw);
    } catch {
      return null;
    }
  }

  /**
   * Write raw config bytes to local storage and refresh parsed config.
   */
  async writeConfigFileRaw(content: Buffer): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      throw new Error('No workspace folder open');
    }

    await this.ensureConfigDirectory(configUri);
    await vscode.workspace.fs.writeFile(configUri, content);
    await this.loadConfig();
  }

  /**
   * Update editor diagnostics (red squiggles) based on validation errors.
   */
  private updateDiagnostics(
    uri: vscode.Uri,
    _text: string,
    errors: ValidationError[],
  ): void {
    if (errors.length === 0) {
      this._diagnosticCollection.set(uri, []);
      return;
    }

    const diagnostics = errors.map(
      (err) =>
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0), // Ideally we'd compute the exact range, but that requires a JSON parser with position info
          `${err.path ? err.path + ': ' : ''}${err.message}`,
          vscode.DiagnosticSeverity.Error,
        ),
    );

    this._diagnosticCollection.set(uri, diagnostics);
  }

  /**
   * Set up a file watcher to detect config changes.
   */
  private setupWatcher(): void {
    if (this._watchFilePath) {
      fs.unwatchFile(this._watchFilePath);
      this._watchFilePath = null;
    }

    const configUri = this.getConfigUri();
    if (!configUri) {
      return;
    }

    this._watchFilePath = configUri.fsPath;
    fs.watchFile(this._watchFilePath, { persistent: false, interval: 1000 }, () => {
      void this.loadConfig();
    });
  }

  /**
   * Scaffold a starter config in local extension storage.
   */
  async initConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      vscode.window.showErrorMessage(
        'Any Sync: No workspace folder open. Please open a folder first.',
      );
      return;
    }

    await this.ensureConfigDirectory(configUri);

    // Check if file already exists
    try {
      await vscode.workspace.fs.stat(configUri);
      const overwrite = await vscode.window.showWarningMessage(
        `${CONFIG_FILENAME} already exists. Overwrite?`,
        'Yes',
        'No',
      );
      if (overwrite !== 'Yes') {
        return;
      }
    } catch {
      // File doesn't exist — good, we'll create it
    }

    const content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(content, 'utf8'),
    );

    await this.loadConfig();

    // Open the file in the editor
    const doc = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `Any Sync: Created ${CONFIG_FILENAME} in VS Code storage. Edit mappings to configure sync.`,
    );
  }

  /**
   * Open the current workspace config file (creating a starter file if needed).
   */
  async openConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      vscode.window.showErrorMessage(
        'Any Sync: No workspace folder open. Please open a folder first.',
      );
      return;
    }

    const exists = await this.fileExists(configUri);
    if (!exists) {
      await this.ensureConfigDirectory(configUri);
      const content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(content, 'utf8'));
      await this.loadConfig();
    }

    const doc = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Reveal the current workspace config file in OS file explorer.
   */
  async revealConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      vscode.window.showErrorMessage(
        'Any Sync: No workspace folder open. Please open a folder first.',
      );
      return;
    }

    const exists = await this.fileExists(configUri);
    if (!exists) {
      vscode.window.showInformationMessage(
        `Any Sync: Config does not exist yet. Run "Any Sync: Edit Config" first.`,
      );
      return;
    }

    await vscode.commands.executeCommand('revealFileInOS', configUri);
  }

  /**
   * Remove local config file and clear loaded config state.
   */
  async resetConfig(): Promise<void> {
    const configUri = this.getConfigUri();

    if (!configUri) {
      this._config = null;
      this._diagnosticCollection.clear();
      this._onDidChangeConfig.fire(null);
      return;
    }

    try {
      await vscode.workspace.fs.delete(configUri, { useTrash: false });
    } catch (err) {
      // Ignore if the config file does not exist.
      if (!(err instanceof vscode.FileSystemError) || err.code !== 'FileNotFound') {
        throw err;
      }
    }

    this._config = null;
    this._diagnosticCollection.clear();
    this._onDidChangeConfig.fire(null);
  }

  /**
   * Migrate legacy workspace-root config into extension storage if needed.
   */
  private async migrateLegacyConfigIfNeeded(): Promise<void> {
    const configUri = this.getConfigUri();
    const legacyUri = this.getLegacyConfigUri();

    if (!configUri || !legacyUri) {
      return;
    }

    const newConfigExists = await this.fileExists(configUri);
    const legacyConfigExists = await this.fileExists(legacyUri);

    if (!newConfigExists && legacyConfigExists) {
      const legacyRaw = await vscode.workspace.fs.readFile(legacyUri);
      await this.ensureConfigDirectory(configUri);
      await vscode.workspace.fs.writeFile(configUri, legacyRaw);

      const deleteLegacy = await vscode.window.showInformationMessage(
        `Any Sync: Migrated ${CONFIG_FILENAME} to VS Code storage so Git won't track it. Delete legacy workspace file?`,
        'Delete Legacy File',
        'Keep',
      );

      if (deleteLegacy === 'Delete Legacy File') {
        try {
          await vscode.workspace.fs.delete(legacyUri, { useTrash: true });
        } catch {
          // Best effort cleanup only.
        }
      }
    }
  }

  private getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    return workspaceFolders[0];
  }

  private getWorkspaceStorageKey(workspaceUri: vscode.Uri): string {
    return createHash('sha1').update(workspaceUri.toString()).digest('hex').slice(0, 16);
  }

  private async ensureConfigDirectory(configUri: vscode.Uri): Promise<void> {
    const configDir = vscode.Uri.file(path.dirname(configUri.fsPath));
    await vscode.workspace.fs.createDirectory(configDir);
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a destPath to an absolute path.
   * If the destPath is relative, resolve it relative to the workspace root.
   *
   * Supported tokens:
   * - ${copilotMemory}: VS Code Copilot memory folder (platform-specific)
   */
  resolveDestPath(mapping: SyncMapping): string {
    const expandedDestPath = this.expandDestPath(mapping.destPath);

    if (this.isAbsolutePath(expandedDestPath)) {
      return expandedDestPath;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }
    return path.join(workspaceRoot, expandedDestPath);
  }

  private isAbsolutePath(destPath: string): boolean {
    // path.isAbsolute handles native absolute paths; regex handles Windows absolute paths on non-Windows hosts.
    return path.isAbsolute(destPath) || /^[a-zA-Z]:[\\/]/.test(destPath) || /^\\\\/.test(destPath);
  }

  private expandDestPath(destPath: string): string {
    return destPath.replace(/\$\{copilotMemory\}/g, this.getCopilotMemoryPath());
  }

  private getCopilotMemoryPath(): string {
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA;
      if (appData && appData.trim()) {
        return path.join(
          appData,
          'Code',
          'User',
          'globalStorage',
          'github.copilot-chat',
          'memory-tool',
          'memories',
        );
      }

      // Fallback for unusual environments where APPDATA is missing.
      return path.join(
        os.homedir(),
        'AppData',
        'Roaming',
        'Code',
        'User',
        'globalStorage',
        'github.copilot-chat',
        'memory-tool',
        'memories',
      );
    }

    if (process.platform === 'darwin') {
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Code',
        'User',
        'globalStorage',
        'github.copilot-chat',
        'memory-tool',
        'memories',
      );
    }

    return path.join(
      os.homedir(),
      '.config',
      'Code',
      'User',
      'globalStorage',
      'github.copilot-chat',
      'memory-tool',
      'memories',
    );
  }

  dispose(): void {
    this._diagnosticCollection.dispose();
    if (this._watchFilePath) {
      fs.unwatchFile(this._watchFilePath);
      this._watchFilePath = null;
    }
    this._onDidChangeConfig.dispose();
  }
}
