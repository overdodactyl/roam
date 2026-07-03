import * as vscode from 'vscode';

const KEY = 'roam.typeFilter';
const CONTEXT = 'roam.typeFilterActive';

/**
 * Persistent list of file extensions to include (e.g. ['.R', '.qmd']).
 * Empty means "no filter". Extensions are stored WITH the leading dot,
 * lowercased.
 */
export class TypeFilterStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.syncContext();
  }

  list(): string[] {
    return this.context.globalState.get<string[]>(KEY, []);
  }

  async set(exts: string[]): Promise<void> {
    const normalized = normalizeExtensions(exts);
    await this.context.globalState.update(KEY, normalized);
    this.syncContext();
    this._onDidChange.fire();
  }

  matches(fileName: string): boolean {
    const filter = this.list();
    if (filter.length === 0) {
      return true;
    }
    const dot = fileName.lastIndexOf('.');
    if (dot < 0) {
      return false;
    }
    return filter.includes(fileName.slice(dot).toLowerCase());
  }

  private syncContext(): void {
    vscode.commands.executeCommand('setContext', CONTEXT, this.list().length > 0);
  }
}

export function normalizeExtensions(exts: string[]): string[] {
  const set = new Set<string>();
  for (const raw of exts) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    set.add(trimmed.startsWith('.') ? trimmed : `.${trimmed}`);
  }
  return [...set].sort();
}

export function parseExtensionList(input: string): string[] {
  return input.split(/[,\s]+/g).map(s => s.trim()).filter(Boolean);
}
