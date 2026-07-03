import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { log } from './logger';

const MAX_INLINE_BYTES = 512 * 1024 * 1024; // 512 MB — no base64 overhead now, we stream bytes.
const SERVER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Downloads a remote file to the user's local machine by:
 *   1. Starting a localhost-only HTTP server on the remote host that
 *      serves exactly one file at a random-token URL with
 *      Content-Disposition: attachment.
 *   2. Getting a client-accessible URL via vscode.env.asExternalUri —
 *      VS Code Remote SSH port-forwards the localhost port through
 *      the SSH tunnel.
 *   3. Opening that URL via vscode.env.openExternal, which uses the
 *      client's default browser. The browser downloads the file to
 *      its usual Downloads folder.
 *
 * This is the only known-reliable way to trigger a real client-side
 * download from a Remote SSH extension. Webview-based blob downloads
 * are silently blocked by VS Code's webview navigation handler.
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

  const filename = path.basename(filePath);
  const mime = guessMime(filename);
  const token = randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    if (url !== `/download/${token}/${encodeURIComponent(filename)}`) {
      res.statusCode = 404;
      res.end('Not found');
      log(`download server: rejected ${url}`);
      return;
    }
    try {
      const bytes = await fs.readFile(filePath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeRfc5987(filename)}"`);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'no-store');
      res.end(bytes);
      log(`download server: served ${filePath} (${bytes.length} bytes)`);
    } catch (err) {
      res.statusCode = 500;
      res.end(`Read error: ${err instanceof Error ? err.message : String(err)}`);
      log(`download server: read failed — ${err instanceof Error ? err.message : err}`);
    } finally {
      // One-shot: shut down shortly after the response drains.
      setTimeout(() => server.close(), 2000);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    vscode.window.showErrorMessage('Could not start local download server.');
    return;
  }
  const port = address.port;
  const localUri = vscode.Uri.parse(`http://127.0.0.1:${port}/download/${token}/${encodeURIComponent(filename)}`);
  log(`download: server listening on 127.0.0.1:${port}, resolving external URI`);

  let externalUri: vscode.Uri;
  try {
    externalUri = await vscode.env.asExternalUri(localUri);
  } catch (err) {
    server.close();
    vscode.window.showErrorMessage(`Could not expose download URL: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  log(`download: external URI is ${externalUri.toString()}`);
  await vscode.env.openExternal(externalUri);

  // Backstop: force-close the server after the timeout even if the client
  // never hits the URL (e.g. openExternal prompt was declined).
  setTimeout(() => {
    if (server.listening) {
      server.close();
      log('download server: closed by timeout');
    }
  }, SERVER_TIMEOUT_MS);

  vscode.window.setStatusBarMessage(`Opening ${filename} in your browser to download…`, 4000);
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
  // Force octet-stream for common code/data files so the browser downloads
  // instead of opening in a tab. The Content-Disposition header should be
  // authoritative anyway, but browsers occasionally overrule it for text
  // MIME types.
  return table[ext] ?? 'application/octet-stream';
}

function encodeRfc5987(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, ch => `_${ch.charCodeAt(0).toString(16)}_`);
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
