import * as path from 'path';

/**
 * Pure formatters and matchers used across the extension. Kept free of any
 * `vscode` imports so they can be unit-tested without a VS Code host.
 */

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  return value < 10 ? `${value.toFixed(1)} ${unit}` : `${Math.round(value)} ${unit}`;
}

export function formatRelativeTime(mtime: number, compact: boolean, now: number = Date.now()): string {
  const diffMs = now - mtime;
  const diffSec = Math.floor(diffMs / 1000);
  const suffix = compact ? '' : ' ago';
  if (diffSec < 60) {
    return compact ? 'now' : 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m${suffix}`;
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return `${diffH}h${suffix}`;
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) {
    return `${diffD}d${suffix}`;
  }
  const d = new Date(mtime);
  const nowD = new Date(now);
  const sameYear = d.getFullYear() === nowD.getFullYear();
  const month = d.toLocaleString(undefined, { month: 'short' });
  const day = d.getDate();
  return sameYear ? `${month} ${day}` : `${month} ${day} ${d.getFullYear()}`;
}

/**
 * Replace a leading $HOME with `~`. Home is looked up from the environment by
 * default; tests may pass an explicit override.
 */
export function collapseHome(p: string, home: string | undefined = process.env.HOME): string {
  if (home && p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  if (home && p === home) {
    return '~';
  }
  return p;
}

/**
 * Expand a leading `~` / `~/` to the absolute home directory, and resolve the
 * result.
 */
export function expandHome(input: string, home: string | undefined = process.env.HOME): string {
  if (!home) {
    return path.resolve(input);
  }
  if (input === '~') {
    return home;
  }
  if (input.startsWith('~/')) {
    return path.resolve(path.join(home, input.slice(2)));
  }
  return path.resolve(input);
}

/**
 * Best-effort MIME lookup for download Content-Type. Unknown extensions fall
 * through to `application/octet-stream` so the browser downloads rather than
 * previews.
 */
export function guessMime(name: string): string {
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

/**
 * Escape any non-ASCII characters in a filename for use in an HTTP
 * Content-Disposition header. Uses a simple `_XX_` hex encoding (not full
 * RFC 5987 UTF-8 encoding) — sufficient for browser downloads to preserve
 * the filename verbatim within the ASCII range.
 */
export function encodeRfc5987(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, ch => `_${ch.charCodeAt(0).toString(16)}_`);
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

/**
 * Sort comparator for directory entries. `foldersFirst` is handled by the
 * caller; this compares within a group.
 */
export type SortBy = 'name' | 'modified' | 'size';
export type SortDirection = 'asc' | 'desc';

export function compareBy(
  sortBy: SortBy,
  direction: SortDirection,
  a: { name: string; mtime?: number; size?: number },
  b: { name: string; mtime?: number; size?: number },
): number {
  const dir = direction === 'desc' ? -1 : 1;
  if (sortBy === 'modified') {
    const am = a.mtime ?? 0;
    const bm = b.mtime ?? 0;
    if (am !== bm) {
      return (am - bm) * dir;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  if (sortBy === 'size') {
    const as = a.size ?? 0;
    const bs = b.size ?? 0;
    if (as !== bs) {
      return (as - bs) * dir;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  // name
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * dir;
}
