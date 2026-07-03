import * as vscode from 'vscode';
import * as fs from 'fs';
import { BookmarkStore } from './bookmarks';
import { BookmarkProvider } from './bookmarkProvider';
import { RecentFilesStore } from './recentFiles';
import { registerCommands } from './commands';
import { BookmarkDragAndDropController } from './dragDrop';
import { GitDecorationProvider } from './gitDecorations';

const SEEDED_KEY = 'dilopsFileBrowser.defaultsSeeded';
const SHOW_HIDDEN_CONTEXT = 'dilopsFileBrowser.showHiddenFiles';
const SHOW_HIDDEN_SETTING = 'showHiddenFiles';

export function activate(context: vscode.ExtensionContext): void {
  const store = new BookmarkStore(context);
  const recent = new RecentFilesStore(context);
  const provider = new BookmarkProvider(store, recent);
  const dragDrop = new BookmarkDragAndDropController(store);

  const treeView = vscode.window.createTreeView('dilopsFileBrowser.tree', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dragDrop,
  });
  context.subscriptions.push(treeView);

  const decorations = new GitDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorations),
    decorations,
  );

  registerCommands(context, store, recent, provider, treeView);
  registerHiddenFilesToggle(context);
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
    vscode.commands.registerCommand('dilopsFileBrowser.enableShowHiddenFiles', async () => {
      await vscode.workspace
        .getConfiguration('dilopsFileBrowser')
        .update(SHOW_HIDDEN_SETTING, true, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('dilopsFileBrowser.disableShowHiddenFiles', async () => {
      await vscode.workspace
        .getConfiguration('dilopsFileBrowser')
        .update(SHOW_HIDDEN_SETTING, false, vscode.ConfigurationTarget.Global);
    }),
  );
}

function registerConfigWatchers(context: vscode.ExtensionContext, provider: BookmarkProvider): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      const browserChanged =
        event.affectsConfiguration('dilopsFileBrowser.showHiddenFiles') ||
        event.affectsConfiguration('dilopsFileBrowser.foldersFirst') ||
        event.affectsConfiguration('dilopsFileBrowser.respectFilesExclude');
      const excludeChanged = event.affectsConfiguration('files.exclude');
      if (event.affectsConfiguration('dilopsFileBrowser.showHiddenFiles')) {
        syncShowHiddenContext();
      }
      if (browserChanged || excludeChanged) {
        provider.refresh();
      }
    }),
  );
}

function syncShowHiddenContext(): void {
  const value = vscode.workspace
    .getConfiguration('dilopsFileBrowser')
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
  const shares = '/shares/nfs/dil/development';
  if (directoryExists(shares)) {
    await store.addBookmark(shares, 'DIL Development');
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
