import * as vscode from 'vscode';

/**
 * Manages GitHub authentication for the extension.
 *
 * Priority order:
 * 1. VSCode's built-in GitHub authentication (vscode.authentication)
 * 2. GITHUB_TOKEN environment variable
 *
 * VSCode auth provides the best UX: it prompts the user to sign in via browser
 * and handles token refresh automatically. The env var fallback supports
 * CI/headless scenarios and users who prefer managing their own tokens.
 */
export class AuthManager implements vscode.Disposable {
  private _token: string | null = null;
  private _sessionChangeSubscription: vscode.Disposable | null = null;
  private _onDidChangeToken = new vscode.EventEmitter<string | null>();

  /** Fires when the auth token changes (e.g., user signs in/out). */
  public readonly onDidChangeToken = this._onDidChangeToken.event;

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  /**
   * Get a valid GitHub token. Tries VSCode auth first, then env var.
   *
   * @param createIfNone - If true, prompts user to sign in if no session exists.
   *                       Set to false for silent checks (e.g., on activation).
   * @returns The GitHub token, or null if not authenticated.
   */
  async getToken(createIfNone: boolean = true): Promise<string | null> {
    // Try VSCode's built-in GitHub auth first
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
      });

      if (session) {
        this._token = session.accessToken;
        this.outputChannel.appendLine('Any Sync: Authenticated via VSCode GitHub session');
        this.listenForSessionChanges();
        return this._token;
      }
    } catch (err) {
      // User cancelled the auth prompt, or auth provider unavailable
      this.outputChannel.appendLine(
        `Any Sync: VSCode auth unavailable or cancelled: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fallback to GITHUB_TOKEN env variable
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) {
      this._token = envToken;
      this.outputChannel.appendLine('Any Sync: Authenticated via GITHUB_TOKEN environment variable');
      return this._token;
    }

    this.outputChannel.appendLine('Any Sync: No authentication available');
    this._token = null;
    return null;
  }

  /**
   * Ensure we have a valid token, showing an error if not.
   * Use this as a guard at the start of commands that need auth.
   *
   * @returns The token if available, or null (with error shown to user).
   */
  async requireToken(): Promise<string | null> {
    const token = await this.getToken(true);
    if (!token) {
      const action = await vscode.window.showErrorMessage(
        'Any Sync: Authentication required. Sign in to GitHub or set GITHUB_TOKEN environment variable.',
        'Sign In',
        'Cancel',
      );

      if (action === 'Sign In') {
        return this.getToken(true);
      }
      return null;
    }
    return token;
  }

  /**
   * Check if we currently have a token (without prompting).
   */
  get isAuthenticated(): boolean {
    return this._token !== null;
  }

  /**
   * Get the cached token without triggering auth flow.
   */
  get currentToken(): string | null {
    return this._token;
  }

  /**
   * Listen for auth session changes (user signs in/out).
   */
  private listenForSessionChanges(): void {
    if (this._sessionChangeSubscription) {
      return; // Already listening
    }

    this._sessionChangeSubscription = vscode.authentication.onDidChangeSessions(
      async (e) => {
        if (e.provider.id === 'github') {
          this.outputChannel.appendLine('Any Sync: GitHub auth session changed, refreshing token');
          const oldToken = this._token;
          await this.getToken(false); // Silent refresh, don't prompt
          if (this._token !== oldToken) {
            this._onDidChangeToken.fire(this._token);
          }
        }
      },
    );
  }

  /**
   * Clear the current token (e.g., for testing or manual sign-out).
   */
  clearToken(): void {
    this._token = null;
    this._onDidChangeToken.fire(null);
  }

  /**
   * Clear auth cache and session preference so the next sign-in can pick another account.
   */
  async resetAuthStatus(): Promise<void> {
    this.clearToken();

    try {
      await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: false,
        silent: true,
        clearSessionPreference: true,
      });
      this.outputChannel.appendLine('Any Sync: Cleared GitHub session preference');
    } catch (err) {
      this.outputChannel.appendLine(
        `Any Sync: Could not clear GitHub session preference: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Prompt VS Code auth flow to use a different GitHub account.
   */
  async signInWithDifferentAccount(): Promise<string | null> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: true,
        forceNewSession: true,
      });

      if (!session) {
        return null;
      }

      this._token = session.accessToken;
      this.listenForSessionChanges();
      this._onDidChangeToken.fire(this._token);
      this.outputChannel.appendLine('Any Sync: Signed in with a new GitHub session');
      return this._token;
    } catch (err) {
      this.outputChannel.appendLine(
        `Any Sync: Sign-in with another account cancelled or failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  dispose(): void {
    this._sessionChangeSubscription?.dispose();
    this._onDidChangeToken.dispose();
  }
}
