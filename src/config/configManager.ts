import * as vscode from 'vscode';
import * as path from 'path';
import { SyncConfig, SyncMapping, ValidationError, validateConfig } from './schema';

const CONFIG_FILENAME = '.any-sync.json';

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
  ],
};

export class ConfigManager implements vscode.Disposable {
  private _config: SyncConfig | null = null;
  private _diagnosticCollection: vscode.DiagnosticCollection;
  private _watcher: vscode.FileSystemWatcher | null = null;
  private _onDidChangeConfig = new vscode.EventEmitter<SyncConfig | null>();

  /** Fires when the config file changes (or is deleted). Payload is the new config or null. */
  public readonly onDidChangeConfig = this._onDidChangeConfig.event;

  constructor() {
    this._diagnosticCollection = vscode.languages.createDiagnosticCollection('any-sync');
  }

  /**
   * Initialize the config manager: read config, set up watcher.
   */
  async initialize(): Promise<void> {
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
   */
  private getConfigUri(): vscode.Uri | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }
    return vscode.Uri.joinPath(workspaceFolders[0].uri, CONFIG_FILENAME);
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
   * Set up a FileSystemWatcher to detect config changes.
   */
  private setupWatcher(): void {
    this._watcher = vscode.workspace.createFileSystemWatcher(
      `**/${CONFIG_FILENAME}`,
    );

    this._watcher.onDidChange(() => this.loadConfig());
    this._watcher.onDidCreate(() => this.loadConfig());
    this._watcher.onDidDelete(() => {
      this._config = null;
      this._diagnosticCollection.clear();
      this._onDidChangeConfig.fire(null);
    });
  }

  /**
   * Scaffold a starter .any-sync.json in the workspace root.
   */
  async initConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      vscode.window.showErrorMessage(
        'Any Sync: No workspace folder open. Please open a folder first.',
      );
      return;
    }

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

    // Open the file in the editor
    const doc = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      `Any Sync: Created ${CONFIG_FILENAME}. Edit the mappings to configure your sync.`,
    );
  }

  /**
   * Remove .any-sync.json and clear loaded config state.
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
   * Resolve a destPath to an absolute path.
   * If the destPath is relative, resolve it relative to the workspace root.
   */
  resolveDestPath(mapping: SyncMapping): string {
    if (path.isAbsolute(mapping.destPath)) {
      return mapping.destPath;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }
    return path.join(workspaceRoot, mapping.destPath);
  }

  dispose(): void {
    this._diagnosticCollection.dispose();
    this._watcher?.dispose();
    this._onDidChangeConfig.dispose();
  }
}
