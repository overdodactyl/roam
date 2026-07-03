import * as vscode from 'vscode';
import * as fs from 'fs';
import { BookmarkStore } from './bookmarks';
import { BookmarkProvider } from './bookmarkProvider';
import { RecentFilesStore } from './recentFiles';
import { registerCommands } from './commands';
import { BookmarkDragAndDropController } from './dragDrop';
import { GitDecorationProvider } from './gitDecorations';
import { BrowserClipboard } from './clipboard';
import { ProjectDecorationProvider } from './projectDecorations';
import { DirectoryWatcher } from './directoryWatcher';
import { TypeFilterStore } from './typeFilter';
import { DiskUsageCache } from './diskUsage';
import { initLogger, log, showLog } from './logger';

const SEEDED_KEY = 'roam.defaultsSeeded';
const SHOW_HIDDEN_CONTEXT = 'roam.showHiddenFiles';
const SHOW_HIDDEN_SETTING = 'showHiddenFiles';
const SHOW_MODIFIED_CONTEXT = 'roam.showModified';
const SHOW_MODIFIED_SETTING = 'showModified';
const SHOW_SIZE_CONTEXT = 'roam.showSize';
const SHOW_SIZE_SETTING = 'showSize';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = initLogger();
  context.subscriptions.push(outputChannel);
  log('extension activated');

  const store = new BookmarkStore(context);
  const recent = new RecentFilesStore(context);
  const typeFilter = new TypeFilterStore(context);
  const diskUsage = new DiskUsageCache();
  const gitDecorations = new GitDecorationProvider();
  const projectDecorations = new ProjectDecorationProvider();
  const provider = new BookmarkProvider(store, recent, typeFilter, diskUsage, gitDecorations);
  const dragDrop = new BookmarkDragAndDropController(store, () => provider.refresh());

  const treeView = vscode.window.createTreeView('roam.tree', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dragDrop,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(gitDecorations),
    vscode.window.registerFileDecorationProvider(projectDecorations),
    gitDecorations,
  );

  const clipboard = new BrowserClipboard();

  // Live refresh has two sources:
  //   1) Every bookmark path is watched unconditionally — expansion state can be
  //      restored by VS Code across window reloads without firing onDidExpand,
  //      so we can't rely on the expand event to seed initial watches.
  //   2) Subfolders the user expands are watched additionally.
  // On bookmark removal / collapse we only unwatch if the path isn't still
  // claimed by the other source.
  const watcher = new DirectoryWatcher(dir => provider.refreshPath(dir));
  context.subscriptions.push(watcher);
  const bookmarkWatched = new Set<string>();
  const expandedWatched = new Set<string>();

  const syncBookmarkWatches = (): void => {
    const nextPaths = new Set(store.listBookmarks().map(b => b.path));
    for (const p of bookmarkWatched) {
      if (!nextPaths.has(p)) {
        bookmarkWatched.delete(p);
        if (!expandedWatched.has(p)) {
          watcher.unwatch(p);
        }
      }
    }
    for (const p of nextPaths) {
      if (!bookmarkWatched.has(p)) {
        bookmarkWatched.add(p);
        watcher.watch(p);
      }
    }
  };
  syncBookmarkWatches();
  context.subscriptions.push(store.onDidChange(syncBookmarkWatches));

  const watchPathFor = (node: unknown): string | undefined => {
    const n = node as { kind?: string; path?: string; bookmark?: { path: string } } | undefined;
    if (!n) {
      return undefined;
    }
    if (n.kind === 'bookmark' && n.bookmark) {
      return n.bookmark.path;
    }
    if (n.kind === 'folder' && n.path) {
      return n.path;
    }
    return undefined;
  };
  context.subscriptions.push(
    treeView.onDidExpandElement(e => {
      const p = watchPathFor(e.element);
      if (p && !expandedWatched.has(p)) {
        expandedWatched.add(p);
        watcher.watch(p);
      }
    }),
    treeView.onDidCollapseElement(e => {
      const p = watchPathFor(e.element);
      if (p && expandedWatched.has(p)) {
        expandedWatched.delete(p);
        if (!bookmarkWatched.has(p)) {
          watcher.unwatch(p);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('roam.showLog', () => showLog()),
  );

  context.subscriptions.push(diskUsage);
  registerCommands(context, store, recent, provider, treeView, clipboard, typeFilter, diskUsage);
  registerHiddenFilesToggle(context);
  registerShowModifiedToggle(context);
  registerShowSizeToggle(context);
  registerConfigWatchers(context, provider);

  seedDefaults(context, store).catch(() => {
    // Non-fatal — user can add bookmarks manually.
  });
}

export function deactivate(): void {
  /* no-op */
}

function registerHiddenFilesToggle(context: vscode.ExtensionContext): void {
  syncShowHiddenContext();

  context.subscriptions.push(
    vscode.commands.registerCommand('roam.enableShowHiddenFiles', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_HIDDEN_SETTING, true, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('roam.disableShowHiddenFiles', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_HIDDEN_SETTING, false, vscode.ConfigurationTarget.Global);
    }),
  );
}

function registerShowModifiedToggle(context: vscode.ExtensionContext): void {
  syncShowModifiedContext();

  context.subscriptions.push(
    vscode.commands.registerCommand('roam.enableShowModified', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_MODIFIED_SETTING, true, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('roam.disableShowModified', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_MODIFIED_SETTING, false, vscode.ConfigurationTarget.Global);
    }),
  );
}

function registerShowSizeToggle(context: vscode.ExtensionContext): void {
  syncShowSizeContext();

  context.subscriptions.push(
    vscode.commands.registerCommand('roam.enableShowSize', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_SIZE_SETTING, true, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('roam.disableShowSize', async () => {
      await vscode.workspace
        .getConfiguration('roam')
        .update(SHOW_SIZE_SETTING, false, vscode.ConfigurationTarget.Global);
    }),
  );
}

function syncShowSizeContext(): void {
  const value = vscode.workspace
    .getConfiguration('roam')
    .get<boolean>(SHOW_SIZE_SETTING, false);
  vscode.commands.executeCommand('setContext', SHOW_SIZE_CONTEXT, value);
}

function registerConfigWatchers(context: vscode.ExtensionContext, provider: BookmarkProvider): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      const browserChanged =
        event.affectsConfiguration('roam.showHiddenFiles') ||
        event.affectsConfiguration('roam.foldersFirst') ||
        event.affectsConfiguration('roam.respectFilesExclude') ||
        event.affectsConfiguration('roam.sortBy') ||
        event.affectsConfiguration('roam.sortDirection') ||
        event.affectsConfiguration('roam.showModified') ||
        event.affectsConfiguration('roam.showSize') ||
        event.affectsConfiguration('roam.modifiedFormat');
      const excludeChanged = event.affectsConfiguration('files.exclude');
      if (event.affectsConfiguration('roam.showHiddenFiles')) {
        syncShowHiddenContext();
      }
      if (event.affectsConfiguration('roam.showModified')) {
        syncShowModifiedContext();
      }
      if (event.affectsConfiguration('roam.showSize')) {
        syncShowSizeContext();
      }
      if (browserChanged || excludeChanged) {
        provider.refresh();
      }
    }),
  );
}

function syncShowModifiedContext(): void {
  const value = vscode.workspace
    .getConfiguration('roam')
    .get<boolean>(SHOW_MODIFIED_SETTING, true);
  vscode.commands.executeCommand('setContext', SHOW_MODIFIED_CONTEXT, value);
}

function syncShowHiddenContext(): void {
  const value = vscode.workspace
    .getConfiguration('roam')
    .get<boolean>(SHOW_HIDDEN_SETTING, false);
  vscode.commands.executeCommand('setContext', SHOW_HIDDEN_CONTEXT, value);
}

async function seedDefaults(context: vscode.ExtensionContext, store: BookmarkStore): Promise<void> {
  if (context.globalState.get<boolean>(SEEDED_KEY)) {
    return;
  }
  if (store.listBookmarks().length > 0) {
    await context.globalState.update(SEEDED_KEY, true);
    return;
  }
  const home = process.env.HOME;
  if (home && directoryExists(home)) {
    await store.addBookmark(home, 'Home');
  }
  await context.globalState.update(SEEDED_KEY, true);
}

function directoryExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
