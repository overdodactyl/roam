import * as vscode from 'vscode';

const RECENT_KEY = 'dilopsFileBrowser.recentFiles';
const MAX_RECENT = 20;

export class RecentFilesStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): string[] {
    return this.context.globalState.get<string[]>(RECENT_KEY, []);
  }

  async record(filePath: string): Promise<void> {
    const current = this.list().filter(p => p !== filePath);
    current.unshift(filePath);
    while (current.length > MAX_RECENT) {
      current.pop();
    }
    await this.context.globalState.update(RECENT_KEY, current);
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(RECENT_KEY, []);
    this._onDidChange.fire();
  }
}
