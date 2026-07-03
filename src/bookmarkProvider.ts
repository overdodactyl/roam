import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { Bookmark, BookmarkStore, Group } from './bookmarks';
import { RecentFilesStore } from './recentFiles';

export type Node =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'group'; group: Group }
  | { kind: 'folder'; path: string; label: string; bookmarkRoot: string }
  | { kind: 'file'; path: string; label: string; bookmarkRoot: string }
  | { kind: 'recent-section' }
  | { kind: 'recent-file'; path: string }
  | { kind: 'error'; message: string; parentPath: string };

export class BookmarkProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly store: BookmarkStore,
    private readonly recent: RecentFilesStore,
  ) {
    store.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
    recent.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(node?: Node): void {
    this._onDidChangeTreeData.fire(node);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'error') {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = 'error';
      return item;
    }

    if (node.kind === 'recent-section') {
      const item = new vscode.TreeItem('Recent', vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('history');
      item.contextValue = 'recentSection';
      item.tooltip = 'Files recently opened through File Browser';
      return item;
    }

    if (node.kind === 'recent-file') {
      const item = new vscode.TreeItem(vscode.Uri.file(node.path), vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'recentFile';
      item.tooltip = node.path;
      item.description = collapseHome(path.dirname(node.path));
      item.command = openFileCommand(node.path);
      return item;
    }

    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('folder-library');
      item.contextValue = 'group';
      item.tooltip = `Group: ${node.group.label}`;
      return item;
    }

    if (node.kind === 'bookmark') {
      const item = new vscode.TreeItem(node.bookmark.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.resourceUri = vscode.Uri.file(node.bookmark.path);
      item.tooltip = node.bookmark.path;
      item.description = collapseHome(node.bookmark.path);
      item.contextValue = 'bookmark';
      item.iconPath = new vscode.ThemeIcon('bookmark');
      return item;
    }

    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(vscode.Uri.file(node.path), vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'folder';
      item.tooltip = node.path;
      return item;
    }

    // file
    const item = new vscode.TreeItem(vscode.Uri.file(node.path), vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'file';
    item.tooltip = node.path;
    item.command = openFileCommand(node.path);
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const roots: Node[] = [];
      if (this.recent.list().length > 0) {
        roots.push({ kind: 'recent-section' });
      }
      for (const group of this.store.listGroups()) {
        roots.push({ kind: 'group', group });
      }
      for (const bookmark of this.store.bookmarksInGroup(undefined)) {
        roots.push({ kind: 'bookmark', bookmark });
      }
      return roots;
    }

    if (node.kind === 'recent-section') {
      return this.recent.list().map(p => ({ kind: 'recent-file', path: p }));
    }

    if (node.kind === 'group') {
      return this.store
        .bookmarksInGroup(node.group.id)
        .map(bookmark => ({ kind: 'bookmark', bookmark }) as Node);
    }

    if (node.kind === 'file' || node.kind === 'error' || node.kind === 'recent-file') {
      return [];
    }

    const dirPath = node.kind === 'bookmark' ? node.bookmark.path : node.path;
    const bookmarkRoot = node.kind === 'bookmark' ? node.bookmark.path : node.bookmarkRoot;
    return readDir(dirPath, bookmarkRoot);
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === 'bookmark') {
      if (node.bookmark.groupId) {
        const group = this.store.findGroup(node.bookmark.groupId);
        if (group) {
          return { kind: 'group', group };
        }
      }
      return undefined;
    }
    if (node.kind === 'folder' || node.kind === 'file') {
      const parentPath = path.dirname(node.path);
      if (parentPath === node.bookmarkRoot) {
        const bookmark = this.store.listBookmarks().find(b => b.path === node.bookmarkRoot);
        return bookmark ? { kind: 'bookmark', bookmark } : undefined;
      }
      return { kind: 'folder', path: parentPath, label: path.basename(parentPath), bookmarkRoot: node.bookmarkRoot };
    }
    return undefined;
  }
}

function openFileCommand(fsPath: string): vscode.Command {
  return {
    command: 'dilopsFileBrowser.openFile',
    title: 'Open',
    arguments: [fsPath],
  };
}

async function readDir(dirPath: string, bookmarkRoot: string): Promise<Node[]> {
  const browserConfig = vscode.workspace.getConfiguration('dilopsFileBrowser');
  const showHidden = browserConfig.get<boolean>('showHiddenFiles', false);
  const foldersFirst = browserConfig.get<boolean>('foldersFirst', true);
  const respectExclude = browserConfig.get<boolean>('respectFilesExclude', true);
  const excludePatterns = respectExclude ? collectFilesExcludePatterns() : [];

  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    const raw = await fs.readdir(dirPath, { withFileTypes: true });
    entries = raw.map(e => ({
      name: e.name,
      isDir: e.isDirectory() || (e.isSymbolicLink() && guessSymlinkIsDir(path.join(dirPath, e.name))),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ kind: 'error', message: `Cannot read: ${message}`, parentPath: dirPath }];
  }

  entries = entries.filter(entry => {
    if (entry.name === '.snapshot') {
      // NetApp snapshot dirs — always hide, they're not real user data.
      return false;
    }
    if (!showHidden && entry.name.startsWith('.')) {
      return false;
    }
    if (excludePatterns.length > 0) {
      const fullPath = path.join(dirPath, entry.name);
      const rel = relativeFromRoot(bookmarkRoot, fullPath);
      if (matchesAny(rel, entry.name, excludePatterns)) {
        return false;
      }
    }
    return true;
  });

  entries.sort((a, b) => {
    if (foldersFirst && a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return entries.map(entry => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDir) {
      return { kind: 'folder', path: fullPath, label: entry.name, bookmarkRoot };
    }
    return { kind: 'file', path: fullPath, label: entry.name, bookmarkRoot };
  });
}

function collectFilesExcludePatterns(): string[] {
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

function relativeFromRoot(bookmarkRoot: string, fullPath: string): string {
  const rel = path.relative(bookmarkRoot, fullPath);
  return rel.split(path.sep).join('/');
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

function guessSymlinkIsDir(linkPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const statSync = require('fs').statSync as (p: string) => { isDirectory(): boolean };
    return statSync(linkPath).isDirectory();
  } catch {
    return false;
  }
}

function collapseHome(p: string): string {
  const home = process.env.HOME;
  if (home && p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  if (home && p === home) {
    return '~';
  }
  return p;
}
