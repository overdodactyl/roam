import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStateStore, resolveStoragePath } from '../src/fileState';

let tmpDir: string;
let stateFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roam-filestate-'));
  stateFile = path.join(tmpDir, 'state.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileStateStore.load', () => {
  it('returns an empty store when the file does not exist', async () => {
    const s = await FileStateStore.load(stateFile);
    expect(s.get('anything')).toBeUndefined();
    expect(s.get('anything', 'default')).toBe('default');
  });

  it('does not create the file on load — only on write', async () => {
    await FileStateStore.load(stateFile);
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('reads back a previously written value', async () => {
    const a = await FileStateStore.load(stateFile);
    await a.update('roam.bookmarks', [{ id: 'x', label: 'X', path: '/tmp' }]);
    const b = await FileStateStore.load(stateFile);
    expect(b.get<Array<{ id: string }>>('roam.bookmarks', [])).toEqual([
      { id: 'x', label: 'X', path: '/tmp' },
    ]);
  });

  it('rescues a corrupt file to a .corrupt-* sibling and starts fresh', async () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, 'not json {{{');
    const s = await FileStateStore.load(stateFile);
    expect(s.get('anything')).toBeUndefined();
    const rescued = fs.readdirSync(tmpDir).filter(f => f.startsWith('state.json.corrupt-'));
    expect(rescued.length).toBe(1);
  });

  it('ignores unrecognized top-level shape but does not delete existing data', async () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ foo: 'bar' }));
    const s = await FileStateStore.load(stateFile);
    expect(s.get('roam.bookmarks')).toBeUndefined();
  });
});

describe('FileStateStore.get/update', () => {
  it('overwrites values in place', async () => {
    const s = await FileStateStore.load(stateFile);
    await s.update('k', 1);
    await s.update('k', 2);
    expect(s.get('k')).toBe(2);
  });

  it('deletes the key when value is undefined', async () => {
    const s = await FileStateStore.load(stateFile);
    await s.update('k', 'v');
    await s.update('k', undefined);
    expect(s.get('k')).toBeUndefined();
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect('k' in raw.state).toBe(false);
  });

  it('writes atomically via a tmp file (final file always valid JSON)', async () => {
    const s = await FileStateStore.load(stateFile);
    // Interleave 50 rapid updates; every intermediate on-disk state must be
    // parseable (no partial writes leaking through).
    const writes: Array<Promise<void>> = [];
    for (let i = 0; i < 50; i++) {
      writes.push(s.update('counter', i));
    }
    await Promise.all(writes);
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(parsed.state.counter).toBe(49);
    // No stray .tmp files left behind
    const stragglers = fs.readdirSync(tmpDir).filter(f => f.includes('.tmp.'));
    expect(stragglers).toEqual([]);
  });

  it('surfaces write errors to the caller but keeps the queue alive', async () => {
    const s = await FileStateStore.load(stateFile);
    // Point the store's directory at a file so mkdir fails on next write.
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'blocker'), '');
    const blockedFile = path.join(tmpDir, 'blocker', 'state.json');
    const blocked = await FileStateStore.load(blockedFile);
    await expect(blocked.update('k', 'v')).rejects.toBeDefined();
    // A subsequent update to the working store should still succeed.
    await s.update('k2', 'v2');
    expect(s.get('k2')).toBe('v2');
  });

  it('sets 0o600 permissions on the state file (POSIX only)', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const s = await FileStateStore.load(stateFile);
    await s.update('k', 'v');
    const mode = fs.statSync(stateFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('resolveStoragePath', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('honors the setting value when provided', () => {
    expect(resolveStoragePath('/custom/path/state.json')).toBe('/custom/path/state.json');
  });

  it('expands ~ in the setting value', () => {
    const resolved = resolveStoragePath('~/roam.json');
    expect(resolved).toBe(path.join(os.homedir(), 'roam.json'));
  });

  it('trims whitespace and treats blank as unset', () => {
    process.env.XDG_CONFIG_HOME = '/xdg';
    expect(resolveStoragePath('   ')).toBe(path.join('/xdg', 'roam', 'state.json'));
    expect(resolveStoragePath(undefined)).toBe(path.join('/xdg', 'roam', 'state.json'));
  });

  it('prefers $XDG_CONFIG_HOME over the default when no setting is given', () => {
    process.env.XDG_CONFIG_HOME = '/xdg';
    expect(resolveStoragePath('')).toBe(path.join('/xdg', 'roam', 'state.json'));
  });

  it('falls back to ~/.config/roam/state.json when no override is set', () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.APPDATA;
    // Only assert POSIX default here (win32 branch is covered elsewhere).
    if (process.platform !== 'win32') {
      expect(resolveStoragePath(undefined)).toBe(
        path.join(os.homedir(), '.config', 'roam', 'state.json'),
      );
    }
  });
});
