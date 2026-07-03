import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Watches directories the user has expanded in the tree, so external file
 * additions/removals (e.g. Slurm output landing in ~/) update the tree
 * without a manual refresh.
 *
 * NFS + fs.watch on Linux is notoriously unreliable — the FS event stream
 * often drops changes made from another host. We accept this: fs.watch is
 * "good enough" for local changes and edits made from the same session,
 * and users always have the refresh button for a hard sync.
 */
export class DirectoryWatcher implements vscode.Disposable {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly onChange: (dir: string) => void) {}

  watch(dir: string): void {
    if (this.watchers.has(dir)) {
      return;
    }
    try {
      const watcher = fs.watch(dir, { persistent: false }, () => this.schedule(dir));
      watcher.on('error', () => this.unwatch(dir));
      this.watchers.set(dir, watcher);
    } catch {
      // fs.watch not supported for this path — silently degrade.
    }
  }

  unwatch(dir: string): void {
    const watcher = this.watchers.get(dir);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      this.watchers.delete(dir);
    }
    const pending = this.pending.get(dir);
    if (pending) {
      clearTimeout(pending);
      this.pending.delete(dir);
    }
  }

  private schedule(dir: string): void {
    const existing = this.pending.get(dir);
    if (existing) {
      clearTimeout(existing);
    }
    this.pending.set(dir, setTimeout(() => {
      this.pending.delete(dir);
      this.onChange(dir);
    }, 200));
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers.clear();
    for (const timeout of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
  }
}
