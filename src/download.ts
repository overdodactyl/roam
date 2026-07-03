import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from './logger';

const MAX_INLINE_BYTES = 100 * 1024 * 1024;

/**
 * Downloads a remote file to the user's local machine by streaming its
 * bytes into a webview, which clicks an <a download> anchor with a
 * data: URI. Webviews run on the client side of Remote SSH, so the
 * browser's native download flow saves to the client's Downloads folder.
 *
 * Limitations:
 *   - Files > 100 MB: base64 encoding + IPC gets expensive. Falls back
 *     to showing a copyable scp command.
 *   - Directories: can't be streamed as a single blob. Same scp fallback.
 *   - The user's browser (Chromium in Positron / VS Code) decides where
 *     to save based on its own download settings — we can suggest a
 *     filename but not a path.
 */
export async function downloadFile(filePath: string, sshHost: string | undefined): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    vscode.window.showErrorMessage(`Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (stat.isDirectory()) {
    await showScpFallback(filePath, sshHost, `${path.basename(filePath)} is a folder — inline download isn't supported.`);
    return;
  }
  if (stat.size > MAX_INLINE_BYTES) {
    await showScpFallback(filePath, sshHost, `${path.basename(filePath)} is ${formatSize(stat.size)} — too large for inline download.`);
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Downloading ${path.basename(filePath)}`,
    cancellable: false,
  }, async () => {
    const bytes = await fs.readFile(filePath);
    const b64 = bytes.toString('base64');
    const name = path.basename(filePath);
    const mime = guessMime(name);

    log(`download ${filePath} (${formatSize(bytes.length)})`);
    await triggerWebviewDownload(name, mime, b64);
  });
}

async function triggerWebviewDownload(filename: string, mime: string, b64: string): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'dilopsFileBrowserDownload',
    `Downloading ${filename}`,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: false },
  );

  panel.webview.html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); }
  code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
</style></head>
<body>
  <p>Downloading <code>${escapeHtml(filename)}</code>…</p>
  <p id="status">Preparing…</p>
  <script>
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    window.addEventListener('message', ({ data }) => {
      if (data && data.kind === 'payload') {
        try {
          const link = document.createElement('a');
          link.href = 'data:' + data.mime + ';base64,' + data.b64;
          link.download = data.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          status.textContent = 'Download started. Check your browser downloads.';
        } catch (err) {
          status.textContent = 'Download failed: ' + err.message;
        }
        setTimeout(() => vscode.postMessage({ kind: 'done' }), 1500);
      }
    });
    vscode.postMessage({ kind: 'ready' });
  </script>
</body>
</html>`;

  await new Promise<void>(resolve => {
    const sub = panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.kind === 'ready') {
        await panel.webview.postMessage({ kind: 'payload', filename, mime, b64 });
      } else if (msg?.kind === 'done') {
        sub.dispose();
        setTimeout(() => panel.dispose(), 500);
        resolve();
      }
    });
    panel.onDidDispose(() => {
      sub.dispose();
      resolve();
    });
  });
}

async function showScpFallback(filePath: string, sshHost: string | undefined, reason: string): Promise<void> {
  const host = sshHost ?? 'gauss.mayo.edu';
  const escaped = filePath.replace(/'/g, `'\\''`);
  const isDir = (await fs.stat(filePath)).isDirectory();
  const scp = isDir
    ? `scp -r ${host}:'${escaped}' ~/Downloads/`
    : `scp ${host}:'${escaped}' ~/Downloads/`;

  const choice = await vscode.window.showInformationMessage(
    `${reason}\n\nRun this from a terminal on your local machine:\n\n${scp}`,
    { modal: true },
    'Copy Command',
  );
  if (choice === 'Copy Command') {
    await vscode.env.clipboard.writeText(scp);
    vscode.window.setStatusBarMessage('scp command copied to clipboard.', 2500);
  }
}

function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const table: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
  };
  return table[ext] ?? 'application/octet-stream';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = units[0];
  for (let i = 1; i < units.length && v >= 1024; i++) {
    v /= 1024;
    u = units[i];
  }
  return v < 10 ? `${v.toFixed(1)} ${u}` : `${Math.round(v)} ${u}`;
}
