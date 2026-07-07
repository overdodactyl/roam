import * as vscode from 'vscode';
import { normalizeExtensions } from './utils';
import type { PersistentState } from './fileState';

export const TYPE_FILTER_KEY = 'roam.typeFilter';
const CONTEXT = 'roam.typeFilterActive';

/**
 * Persistent list of file extensions to include (e.g. ['.R', '.qmd']).
 * Empty means "no filter". Extensions are stored WITH the leading dot,
 * lowercased.
 */
export class TypeFilterStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: PersistentState) {
    this.syncContext();
  }

  list(): string[] {
    return this.state.get<string[]>(TYPE_FILTER_KEY, []);
  }

  async set(exts: string[]): Promise<void> {
    const normalized = normalizeExtensions(exts);
    await this.state.update(TYPE_FILTER_KEY, normalized);
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

export { normalizeExtensions, parseExtensionList } from './utils';
