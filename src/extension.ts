import * as vscode from 'vscode';
import * as fs from 'fs';
import { BookmarkStore, BOOKMARKS_KEY, GROUPS_KEY } from './bookmarks';
import { BookmarkProvider } from './bookmarkProvider';
import { RecentFilesStore, RECENT_KEY } from './recentFiles';
import { registerCommands } from './commands';
import { BookmarkDragAndDropController } from './dragDrop';
import { GitDecorationProvider } from './gitDecorations';
import { BrowserClipboard } from './clipboard';
import { ProjectDecorationProvider } from './projectDecorations';
import { DirectoryWatcher } from './directoryWatcher';
import { TypeFilterStore, TYPE_FILTER_KEY } from './typeFilter';
import { DiskUsageCache } from './diskUsage';
import { initLogger, log, showLog } from './logger';
import { FileStateStore, PersistentState, resolveStoragePath } from './fileState';

const SEEDED_KEY = 'roam.defaultsSeeded';
const MIGRATED_KEY = 'roam.migratedFromGlobalState';
const SHOW_HIDDEN_CONTEXT = 'roam.showHiddenFiles';
const SHOW_HIDDEN_SETTING = 'showHiddenFiles';
const SHOW_MODIFIED_CONTEXT = 'roam.showModified';
const SHOW_MODIFIED_SETTING = 'showModified';
const SHOW_SIZE_CONTEXT = 'roam.showSize';
const SHOW_SIZE_SETTING = 'showSize';

const MIGRATION_KEYS = [BOOKMARKS_KEY, GROUPS_KEY, RECENT_KEY, TYPE_FILTER_KEY, SEEDED_KEY];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = initLogger();
  context.subscriptions.push(outputChannel);
  log('extension activated');

  const state = await loadPersistentState(context);
  const store = new BookmarkStore(state);
  const recent = new RecentFilesStore(state);
  const typeFilter = new TypeFilterStore(state);
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

  seedDefaults(state, store).catch(() => {
    // Non-fatal — user can add bookmarks manually.
  });
}

async function loadPersistentState(context: vscode.ExtensionContext): Promise<FileStateStore> {
  const settingValue = vscode.workspace.getConfiguration('roam').get<string>('storagePath');
  const filePath = resolveStoragePath(settingValue);
  const state = await FileStateStore.load(filePath);
  log(`state file: ${filePath}`);
  await migrateFromGlobalState(context, state);
  return state;
}

async function migrateFromGlobalState(
  context: vscode.ExtensionContext,
  state: FileStateStore,
): Promise<void> {
  if (state.get<boolean>(MIGRATED_KEY, false)) {
    return;
  }
  let migrated = 0;
  for (const key of MIGRATION_KEYS) {
    const oldValue = context.globalState.get<unknown>(key);
    const alreadyInFile = state.get<unknown>(key);
    if (oldValue !== undefined && alreadyInFile === undefined) {
      await state.update(key, oldValue);
      migrated++;
    }
  }
  await state.update(MIGRATED_KEY, true);
  if (migrated > 0) {
    log(`migrated ${migrated} state key${migrated === 1 ? '' : 's'} from globalState to file`);
  }
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

async function seedDefaults(state: PersistentState, store: BookmarkStore): Promise<void> {
  if (state.get<boolean>(SEEDED_KEY, false)) {
    return;
  }
  if (store.listBookmarks().length > 0) {
    await state.update(SEEDED_KEY, true);
    return;
  }
  const home = process.env.HOME;
  if (home && directoryExists(home)) {
    await store.addBookmark(home, 'Home');
  }
  await state.update(SEEDED_KEY, true);
}

function directoryExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
