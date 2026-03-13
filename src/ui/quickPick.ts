import * as vscode from 'vscode';
import { SyncMapping } from '../config/schema';

/**
 * Show a QuickPick to let user select one or more mappings.
 *
 * @param mappings - Available sync mappings
 * @param action - "pull" or "push" — used in the title
 * @returns Selected mappings, or undefined if cancelled
 */
export async function pickMappings(
  mappings: SyncMapping[],
  action: 'pull' | 'push',
): Promise<SyncMapping[] | undefined> {
  if (mappings.length === 0) {
    vscode.window.showWarningMessage(
      'Any Sync: No mappings configured. Run "Any Sync: Init Config" to create a config file.',
    );
    return undefined;
  }

  if (mappings.length === 1) {
    return mappings;
  }

  const items = mappings.map((m) => ({
    label: m.name,
    description: `${m.repo}:${m.sourcePath} → ${m.destPath}`,
    detail: m.branch ? `Branch: ${m.branch}` : 'Branch: default',
    mapping: m,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Any Sync: Select mappings to ${action}`,
    placeHolder: `Choose which mappings to ${action}`,
    canPickMany: true,
    ignoreFocusOut: true,
  });

  if (!picked || picked.length === 0) {
    return undefined;
  }

  return picked.map((p) => p.mapping);
}
