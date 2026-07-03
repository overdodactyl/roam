import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as vscode from 'vscode';
import { log } from './logger';

const DEFAULT_POLL_MS = 3000;
const DEBOUNCE_MS = 200;

interface WatchEntry {
  fsWatcher?: fs.FSWatcher;
  poller?: NodeJS.Timeout;
  signature: string;
  pending?: NodeJS.Timeout;
}

/**
 * Watches directories the user has expanded so external file additions /
 * removals (Slurm output, `mv` from a shell, git branch checkout) update
 * the tree without a manual refresh.
 *
 * On Gauss basically everything is NFS-mounted, and inotify (fs.watch)
 * doesn't reliably deliver events for NFS. So we use a two-pronged
 * approach: fs.watch gives near-instant refresh when it works (local FS,
 * some SMB mounts) and a periodic readdir poll catches everything else.
 * The poll signature is a sorted list of "name:type" strings computed
 * from readdir(withFileTypes) — cheap enough to run every few seconds.
 */
export class DirectoryWatcher implements vscode.Disposable {
  private readonly entries = new Map<string, WatchEntry>();

  constructor(private readonly onChange: (dir: string) => void) {}

  watch(dir: string): void {
    if (this.entries.has(dir)) {
      return;
    }
    const entry: WatchEntry = { signature: '' };
    this.entries.set(dir, entry);

    // Prime the signature so the first poll doesn't spuriously fire.
    this.computeSignature(dir).then(sig => {
      const current = this.entries.get(dir);
      if (current) {
        current.signature = sig;
      }
    }).catch(() => undefined);

    try {
      entry.fsWatcher = fs.watch(dir, { persistent: false }, () => this.schedule(dir, 'fs.watch'));
      entry.fsWatcher.on('error', err => {
        log(`fs.watch error for ${dir}: ${err.message} — falling back to polling`);
        entry.fsWatcher?.close();
        entry.fsWatcher = undefined;
      });
    } catch (err) {
      log(`fs.watch failed to start for ${dir}: ${err instanceof Error ? err.message : err} — polling only`);
    }

    const interval = pollingInterval();
    entry.poller = setInterval(() => this.pollOnce(dir), interval);
    log(`watch ${dir} (poll every ${interval}ms, fs.watch=${entry.fsWatcher ? 'on' : 'off'})`);
  }

  unwatch(dir: string): void {
    const entry = this.entries.get(dir);
    if (!entry) {
      return;
    }
    try {
      entry.fsWatcher?.close();
    } catch {
      /* ignore */
    }
    if (entry.poller) {
      clearInterval(entry.poller);
    }
    if (entry.pending) {
      clearTimeout(entry.pending);
    }
    this.entries.delete(dir);
    log(`unwatch ${dir}`);
  }

  private async pollOnce(dir: string): Promise<void> {
    const entry = this.entries.get(dir);
    if (!entry) {
      return;
    }
    const sig = await this.computeSignature(dir);
    if (sig !== entry.signature) {
      log(`poll detected change in ${dir}`);
      entry.signature = sig;
      this.schedule(dir, 'poll');
    }
  }

  private schedule(dir: string, source: string): void {
    const entry = this.entries.get(dir);
    if (!entry) {
      return;
    }
    if (entry.pending) {
      clearTimeout(entry.pending);
    }
    entry.pending = setTimeout(() => {
      entry.pending = undefined;
      // Refresh signature so the poller doesn't re-fire immediately.
      this.computeSignature(dir).then(sig => {
        const current = this.entries.get(dir);
        if (current) {
          current.signature = sig;
        }
      }).catch(() => undefined);
      log(`refresh fired for ${dir} (via ${source})`);
      this.onChange(dir);
    }, DEBOUNCE_MS);
  }

  private async computeSignature(dir: string): Promise<string> {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const parts = entries
        .map(e => `${e.name}:${e.isDirectory() ? 'd' : e.isSymbolicLink() ? 'l' : 'f'}`)
        .sort();
      return parts.join('|');
    } catch {
      return '<unreadable>';
    }
  }

  dispose(): void {
    for (const dir of [...this.entries.keys()]) {
      this.unwatch(dir);
    }
  }
}

function pollingInterval(): number {
  const configured = vscode.workspace
    .getConfiguration('roam')
    .get<number>('watchPollingIntervalMs', DEFAULT_POLL_MS);
  if (!Number.isFinite(configured) || configured < 500) {
    return DEFAULT_POLL_MS;
  }
  return Math.floor(configured);
}
