import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Minimal Memento-shaped interface. Roam stores use only get/update,
 * so we don't take a dependency on the full vscode.Memento surface.
 */
export interface PersistentState {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}

interface OnDiskShape {
  version: number;
  state: Record<string, unknown>;
}

const CURRENT_VERSION = 1;

/**
 * JSON-file backed key-value store with a Memento-shaped API. Loaded once
 * into memory; mutations queue serialized atomic writes so concurrent
 * updates within a single session can't corrupt the file.
 *
 * NOTE: Multiple extension hosts (e.g. two Positron windows) share the file
 * but not the in-memory cache. Last-write-wins across hosts, same as
 * VS Code's own globalState across windows on the same machine.
 */
export class FileStateStore implements PersistentState {
  private cache: Record<string, unknown>;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string, initial: Record<string, unknown>) {
    this.cache = initial;
  }

  static async load(filePath: string): Promise<FileStateStore> {
    let initial: Record<string, unknown> = {};
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as OnDiskShape;
      if (parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object') {
        initial = parsed.state as Record<string, unknown>;
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        // File exists but is unreadable / unparseable. Move it aside so a
        // fresh store can be created — don't silently overwrite user data.
        const rescue = `${filePath}.corrupt-${Date.now()}`;
        try {
          await fs.promises.rename(filePath, rescue);
        } catch {
          /* best-effort */
        }
      }
    }
    return new FileStateStore(filePath, initial);
  }

  path(): string {
    return this.filePath;
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.cache[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.cache[key];
    } else {
      this.cache[key] = value;
    }
    // Snapshot cache at call time so queued writes serialize with the
    // state they were requested against.
    const snapshot: OnDiskShape = { version: CURRENT_VERSION, state: { ...this.cache } };
    const write = this.writeChain.then(() => writeAtomic(this.filePath, snapshot));
    // Swallow errors on the chain so one failed write doesn't poison later ones;
    // still surface the error to the current caller.
    this.writeChain = write.catch(() => undefined);
    return write;
  }
}

async function writeAtomic(filePath: string, data: OnDiskShape): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${process.hrtime.bigint()}`;
  const content = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(tmp, filePath);
}

/**
 * Resolve the storage file path. Precedence:
 *   1. `roam.storagePath` setting (tilde expanded, absolute path expected)
 *   2. `$XDG_CONFIG_HOME/roam/state.json` if XDG_CONFIG_HOME is set
 *   3. Windows: `%APPDATA%/roam/state.json`
 *   4. Fallback: `~/.config/roam/state.json`
 */
export function resolveStoragePath(settingValue: string | undefined): string {
  const trimmed = settingValue?.trim();
  if (trimmed) {
    return expandTilde(trimmed);
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return path.join(xdg, 'roam', 'state.json');
  }
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) {
      return path.join(appdata, 'roam', 'state.json');
    }
  }
  return path.join(os.homedir(), '.config', 'roam', 'state.json');
}

function expandTilde(p: string): string {
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
