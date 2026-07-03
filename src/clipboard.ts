import * as vscode from 'vscode';

export type ClipboardMode = 'copy' | 'cut';

interface ClipboardState {
  mode: ClipboardMode;
  paths: string[];
}

export class BrowserClipboard {
  private state: ClipboardState | null = null;

  set(mode: ClipboardMode, paths: string[]): void {
    if (paths.length === 0) {
      this.clear();
      return;
    }
    this.state = { mode, paths: [...paths] };
    this.updateContext();
  }

  get(): ClipboardState | null {
    return this.state;
  }

  clear(): void {
    this.state = null;
    this.updateContext();
  }

  private updateContext(): void {
    vscode.commands.executeCommand('setContext', 'dilopsFileBrowser.hasClipboard', !!this.state);
    vscode.commands.executeCommand(
      'setContext',
      'dilopsFileBrowser.clipboardMode',
      this.state?.mode ?? null,
    );
  }
}
