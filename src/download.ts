import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from './logger';

const MAX_INLINE_BYTES = 100 * 1024 * 1024;

/**
 * Downloads a remote file to the user's local machine by streaming its
 * bytes into a webview, which builds a Blob and clicks a download link.
 * Because webviews run on the client side of Remote SSH, the browser's
 * native download flow saves to the client's Downloads folder.
 *
 * Auto-clicked anchor downloads with data: URIs get silently blocked by
 * VS Code's webview navigation handler. Two things make this reliable:
 *   - blob: URL from URL.createObjectURL (same-origin to the webview)
 *   - user-initiated click on a "Save" button (browsers trust these)
 *
 * Limitations:
 *   - Files > 100 MB: base64 encoding + IPC gets expensive. Falls back
 *     to showing a copyable scp command.
 *   - Directories: can't be streamed as a single blob. Same scp fallback.
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

  const bytes = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Preparing ${path.basename(filePath)}`,
    cancellable: false,
  }, async () => fs.readFile(filePath));

  const b64 = bytes.toString('base64');
  const name = path.basename(filePath);
  const mime = guessMime(name);

  log(`download ${filePath} (${formatSize(bytes.length)}) — opening webview`);
  openDownloadPanel(name, mime, b64);
}

function openDownloadPanel(filename: string, mime: string, b64: string): void {
  const panel = vscode.window.createWebviewPanel(
    'dilopsFileBrowserDownload',
    `Download ${filename}`,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = renderHtml(panel.webview, filename, mime, b64);

  panel.webview.onDidReceiveMessage(msg => {
    if (msg?.kind === 'log') {
      log(`download webview: ${msg.message}`);
    } else if (msg?.kind === 'close') {
      panel.dispose();
    }
  });
}

function renderHtml(webview: vscode.Webview, filename: string, mime: string, b64: string): string {
  const nonce = randomNonce();
  // CSP: allow inline script under nonce, blob URLs for download, and the
  // webview's own scheme. Default-src 'none' locks everything else down.
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    // No explicit allowance needed for anchor href=blob: — user-triggered
    // downloads aren't gated by CSP.
  ].join('; ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 32px;
      max-width: 640px;
    }
    h2 { margin-top: 0; font-weight: 500; }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 18px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      border-radius: 2px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: default; }
    #status { color: var(--vscode-descriptionForeground); margin-top: 12px; font-size: 12px; }
    #error { color: var(--vscode-errorForeground); margin-top: 12px; font-size: 12px; white-space: pre-wrap; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <h2>Download <code>${escapeHtml(filename)}</code></h2>
  <p>Click the button below to save this file to your local computer's Downloads folder.</p>
  <p>
    <button id="save-btn">Save file</button>
    <button id="close-btn" style="margin-left: 8px; background: transparent; color: var(--vscode-foreground);">Cancel</button>
  </p>
  <div id="status">Ready.</div>
  <div id="error"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const errorEl = document.getElementById('error');
    const saveBtn = document.getElementById('save-btn');
    const closeBtn = document.getElementById('close-btn');
    const filename = ${JSON.stringify(filename)};
    const mime = ${JSON.stringify(mime)};
    const b64 = ${JSON.stringify(b64)};

    function b64ToBytes(str) {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }

    saveBtn.addEventListener('click', () => {
      try {
        const bytes = b64ToBytes(b64);
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status.textContent = 'Save triggered — check your browser\\'s downloads.';
        saveBtn.disabled = true;
        vscode.postMessage({ kind: 'log', message: 'save clicked, blob download triggered' });
      } catch (err) {
        errorEl.textContent = 'Download failed: ' + (err && err.message ? err.message : String(err));
        vscode.postMessage({ kind: 'log', message: 'save failed: ' + (err && err.message ? err.message : String(err)) });
      }
    });

    closeBtn.addEventListener('click', () => vscode.postMessage({ kind: 'close' }));
  </script>
</body>
</html>`;
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

function randomNonce(): string {
  // Not security-critical; just a per-panel nonce for CSP.
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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
