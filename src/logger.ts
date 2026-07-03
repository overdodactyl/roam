import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('File Browser');
  }
  return channel;
}

export function log(message: string): void {
  if (!channel) {
    return;
  }
  const ts = new Date().toISOString().slice(11, 23);
  channel.appendLine(`[${ts}] ${message}`);
}

export function showLog(): void {
  channel?.show(true);
}
