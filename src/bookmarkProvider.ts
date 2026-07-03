import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { Bookmark, BookmarkStore, Group } from './bookmarks';
import { RecentFilesStore } from './recentFiles';

export type SortBy = 'name' | 'modified' | 'size';
export type SortDirection = 'asc' | 'desc';

export type Node =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'group'; group: Group }
  | { kind: 'folder'; path: string; label: string; bookmarkRoot: string; mtime?: number; size?: number }
  | { kind: 'file'; path: string; label: string; bookmarkRoot: string; mtime?: number; size?: number }
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
      item.tooltip = tooltipFor(node);
      item.description = descriptionFor(node);
      return item;
    }

    // file
    const item = new vscode.TreeItem(vscode.Uri.file(node.path), vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'file';
    item.tooltip = tooltipFor(node);
    item.description = descriptionFor(node);
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
  const sortBy = browserConfig.get<SortBy>('sortBy', 'name');
  const sortDirection = browserConfig.get<SortDirection>('sortDirection', 'asc');
  const excludePatterns = respectExclude ? collectFilesExcludePatterns() : [];

  interface RawEntry {
    name: string;
    fullPath: string;
    isDir: boolean;
    mtime?: number;
    size?: number;
  }

  let raw: Dirent[];
  try {
    raw = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ kind: 'error', message: `Cannot read: ${message}`, parentPath: dirPath }];
  }

  // Pre-filter names before we spend the stat syscalls.
  const filtered = raw.filter(e => {
    if (e.name === '.snapshot') {
      return false;
    }
    if (!showHidden && e.name.startsWith('.')) {
      return false;
    }
    if (excludePatterns.length > 0) {
      const rel = relativeFromRoot(bookmarkRoot, path.join(dirPath, e.name));
      if (matchesAny(rel, e.name, excludePatterns)) {
        return false;
      }
    }
    return true;
  });

  const entries: RawEntry[] = await Promise.all(filtered.map(async e => {
    const fullPath = path.join(dirPath, e.name);
    let isDir = e.isDirectory();
    let mtime: number | undefined;
    let size: number | undefined;
    try {
      // Follow symlinks for isDir determination and for mtime/size display.
      const stat = await fs.stat(fullPath);
      isDir = stat.isDirectory();
      mtime = stat.mtimeMs;
      size = stat.size;
    } catch {
      // stat may fail on broken symlinks or ACL-restricted paths; fall back to dirent flags.
      if (e.isSymbolicLink()) {
        isDir = false;
      }
    }
    return { name: e.name, fullPath, isDir, mtime, size };
  }));

  entries.sort((a, b) => {
    if (foldersFirst && a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return compareBy(sortBy, sortDirection, a, b);
  });

  return entries.map(entry => {
    if (entry.isDir) {
      return { kind: 'folder', path: entry.fullPath, label: entry.name, bookmarkRoot, mtime: entry.mtime, size: entry.size };
    }
    return { kind: 'file', path: entry.fullPath, label: entry.name, bookmarkRoot, mtime: entry.mtime, size: entry.size };
  });
}

function compareBy(
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

function tooltipFor(node: { path: string; mtime?: number; size?: number }): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`\`${node.path}\``);
  if (node.mtime !== undefined) {
    md.appendMarkdown(`  \nModified: ${new Date(node.mtime).toLocaleString()}`);
  }
  if (node.size !== undefined) {
    md.appendMarkdown(`  \nSize: ${formatSize(node.size)}`);
  }
  return md;
}

function descriptionFor(node: { mtime?: number; size?: number; kind: 'file' | 'folder' }): string {
  const cfg = vscode.workspace.getConfiguration('dilopsFileBrowser');
  const showModified = cfg.get<boolean>('showModified', true);
  const showSize = cfg.get<boolean>('showSize', false);
  const compact = cfg.get<string>('modifiedFormat', 'compact') === 'compact';
  const bits: string[] = [];
  if (showModified && node.mtime !== undefined) {
    bits.push(formatRelativeTime(node.mtime, compact));
  }
  if (showSize && node.size !== undefined && node.kind === 'file') {
    bits.push(formatSize(node.size));
  }
  return bits.join('  ·  ');
}

function formatRelativeTime(mtime: number, compact: boolean): string {
  const now = Date.now();
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

function formatSize(bytes: number): string {
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
