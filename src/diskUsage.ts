import { execFile } from 'child_process';
import * as vscode from 'vscode';

const TTL_MS = 5 * 60 * 1000;
const DU_TIMEOUT_MS = 30 * 1000;

interface CacheEntry {
  bytes: number;
  timestamp: number;
}

/**
 * Lazy async disk-usage lookup per directory. Uses `du -sb` (bytes summary)
 * which is native-speed vs. Node's recursive stat. Results cached with a
 * 5-minute TTL, and a per-directory in-flight promise so concurrent lookups
 * for the same path share the same du invocation.
 */
export class DiskUsageCache implements vscode.Disposable {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<number>>();
  private readonly _onDidUpdate = new vscode.EventEmitter<string>();
  readonly onDidUpdate = this._onDidUpdate.event;

  /**
   * Returns the cached size synchronously if fresh, otherwise `undefined`
   * and kicks off a background computation that will fire `onDidUpdate`
   * with the directory path when it completes.
   */
  peek(dir: string): number | undefined {
    const entry = this.cache.get(dir);
    if (entry && Date.now() - entry.timestamp < TTL_MS) {
      return entry.bytes;
    }
    this.trigger(dir);
    return undefined;
  }

  private trigger(dir: string): void {
    if (this.pending.has(dir)) {
      return;
    }
    const p = this.compute(dir);
    this.pending.set(dir, p);
    p.then(bytes => {
      this.cache.set(dir, { bytes, timestamp: Date.now() });
      this._onDidUpdate.fire(dir);
    }).catch(() => {
      // Leave the cache empty so a future call retries.
    }).finally(() => {
      this.pending.delete(dir);
    });
  }

  invalidate(dir?: string): void {
    if (dir) {
      this.cache.delete(dir);
    } else {
      this.cache.clear();
    }
    this._onDidUpdate.fire(dir ?? '');
  }

  private compute(dir: string): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile('du', ['-sb', dir], { timeout: DU_TIMEOUT_MS }, (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const match = stdout.match(/^(\d+)/);
        if (match) {
          resolve(parseInt(match[1], 10));
        } else {
          reject(new Error(`Unexpected du output: ${stdout.slice(0, 60)}`));
        }
      });
    });
  }

  dispose(): void {
    this._onDidUpdate.dispose();
  }
}

export function formatBytes(bytes: number): string {
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
