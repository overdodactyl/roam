import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';

const RESULT_LIMIT = 5000;

interface SearchResult {
  fullPath: string;
  relPath: string;
}

export async function searchBookmark(rootPath: string, rootLabel: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('roam');
  const showHidden = config.get<boolean>('showHiddenFiles', false);
  const respectExclude = config.get<boolean>('respectFilesExclude', true);
  const excludePatterns = respectExclude ? collectExcludePatterns() : [];

  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { fullPath?: string }>();
  quickPick.title = `Search in ${rootLabel}`;
  quickPick.placeholder = 'Type to filter…';
  quickPick.matchOnDescription = true;
  quickPick.busy = true;
  quickPick.show();

  const cancel = new vscode.CancellationTokenSource();
  quickPick.onDidHide(() => {
    cancel.cancel();
    quickPick.dispose();
  });

  const results: SearchResult[] = [];
  let hitLimit = false;

  const setItems = (): void => {
    quickPick.items = results.map(r => ({
      label: path.basename(r.fullPath),
      description: r.relPath === path.basename(r.fullPath) ? '' : path.dirname(r.relPath),
      fullPath: r.fullPath,
    }));
  };

  const walkPromise = walk(rootPath, rootPath, excludePatterns, showHidden, cancel.token, entry => {
    if (results.length >= RESULT_LIMIT) {
      hitLimit = true;
      return false;
    }
    results.push(entry);
    if (results.length % 200 === 0) {
      setItems();
    }
    return true;
  });

  quickPick.onDidAccept(async () => {
    const picked = quickPick.selectedItems[0];
    if (picked?.fullPath) {
      const uri = vscode.Uri.file(picked.fullPath);
      try {
        const stat = await fs.stat(picked.fullPath);
        if (stat.isDirectory()) {
          // Open a new terminal there rather than opening as a file (which would fail).
          const terminal = vscode.window.createTerminal({ cwd: picked.fullPath });
          terminal.show();
        } else {
          await vscode.commands.executeCommand('vscode.open', uri);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Cannot open ${picked.fullPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    cancel.cancel();
    quickPick.hide();
  });

  await walkPromise;
  setItems();
  quickPick.busy = false;
  if (hitLimit) {
    quickPick.title = `Search in ${rootLabel} (first ${RESULT_LIMIT} results — refine your search)`;
  } else if (results.length === 0) {
    quickPick.title = `Search in ${rootLabel} — no files found`;
  }
}

async function walk(
  rootPath: string,
  currentPath: string,
  excludePatterns: string[],
  showHidden: boolean,
  token: vscode.CancellationToken,
  emit: (entry: SearchResult) => boolean,
): Promise<void> {
  if (token.isCancellationRequested) {
    return;
  }
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    const raw = await fs.readdir(currentPath, { withFileTypes: true });
    entries = raw.map(e => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (token.isCancellationRequested) {
      return;
    }
    if (entry.name === '.snapshot') {
      continue;
    }
    if (!showHidden && entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(currentPath, entry.name);
    const relPath = path.relative(rootPath, fullPath).split(path.sep).join('/');
    if (matchesAny(relPath, entry.name, excludePatterns)) {
      continue;
    }

    if (entry.isDir) {
      await walk(rootPath, fullPath, excludePatterns, showHidden, token, emit);
    } else {
      const keepGoing = emit({ fullPath, relPath });
      if (!keepGoing) {
        return;
      }
    }
  }
}

function collectExcludePatterns(): string[] {
  const cfg = vscode.workspace.getConfiguration('files');
  const raw = cfg.get<Record<string, unknown>>('exclude', {});
  const patterns: string[] = [];
  for (const [glob, value] of Object.entries(raw)) {
    if (value) {
      patterns.push(glob);
    }
  }
  return patterns;
}

function matchesAny(relPath: string, basename: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (minimatch(relPath, pattern, { dot: true, matchBase: true })) {
      return true;
    }
    if (!pattern.includes('/') && minimatch(basename, pattern, { dot: true })) {
      return true;
    }
  }
  return false;
}
