import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BookmarkStore } from './bookmarks';
import { BookmarkProvider, Node } from './bookmarkProvider';
import { RecentFilesStore } from './recentFiles';
import { searchBookmark } from './search';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: BookmarkStore,
  recent: RecentFilesStore,
  provider: BookmarkProvider,
  treeView: vscode.TreeView<Node>,
): void {
  const sub = context.subscriptions;

  // --- Bookmarks --------------------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.addBookmark', async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Bookmark this folder',
      title: 'Add Bookmark',
    });
    if (!picked || picked.length === 0) {
      return;
    }
    await store.addBookmark(picked[0].fsPath);
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.addBookmarkByPath', async () => {
    const input = await vscode.window.showInputBox({
      prompt: 'Absolute path to bookmark',
      placeHolder: '/shares/nfs/dil/development/  or  ~/projects',
      value: process.env.HOME ?? '',
      validateInput: v => (v.trim() ? undefined : 'Path is required'),
    });
    if (!input) {
      return;
    }
    const resolved = expandHome(input.trim());
    if (!(await isDirectory(resolved))) {
      vscode.window.showErrorMessage(`Not a directory: ${resolved}`);
      return;
    }
    await store.addBookmark(resolved);
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.removeBookmark', async (node?: Node, selection?: Node[]) => {
    const targets = pickBookmarks(node, selection);
    if (targets.length === 0) {
      return;
    }
    if (targets.length > 1) {
      const confirm = await vscode.window.showWarningMessage(
        `Remove ${targets.length} bookmarks?`,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') {
        return;
      }
    }
    for (const b of targets) {
      await store.removeBookmark(b.id);
    }
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.renameBookmark', async (node?: Node) => {
    if (node?.kind !== 'bookmark') {
      return;
    }
    const newLabel = await vscode.window.showInputBox({
      prompt: 'New label for bookmark',
      value: node.bookmark.label,
      validateInput: v => (v.trim() ? undefined : 'Label cannot be empty'),
    });
    if (!newLabel) {
      return;
    }
    await store.renameBookmark(node.bookmark.id, newLabel.trim());
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.moveBookmarkToGroup', async (node?: Node) => {
    if (node?.kind !== 'bookmark') {
      return;
    }
    const groups = store.listGroups();
    type Pick = vscode.QuickPickItem & { groupId?: string; createNew?: boolean };
    const items: Pick[] = [
      { label: '$(remove) No group (top level)', groupId: undefined },
      ...groups.map(g => ({ label: `$(folder-library) ${g.label}`, groupId: g.id })),
      { label: '$(add) Create new group…', createNew: true },
    ];
    const chosen = await vscode.window.showQuickPick(items, { placeHolder: `Move "${node.bookmark.label}" to…` });
    if (!chosen) {
      return;
    }
    if (chosen.createNew) {
      const newLabel = await vscode.window.showInputBox({
        prompt: 'New group name',
        validateInput: v => (v.trim() ? undefined : 'Name cannot be empty'),
      });
      if (!newLabel) {
        return;
      }
      const group = await store.addGroup(newLabel.trim());
      await store.moveBookmarkToGroup(node.bookmark.id, group.id);
      return;
    }
    await store.moveBookmarkToGroup(node.bookmark.id, chosen.groupId);
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.addChildAsBookmark', async (node?: Node) => {
    if (node?.kind !== 'folder') {
      return;
    }
    await store.addBookmark(node.path);
  }));

  // --- Groups -----------------------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.newGroup', async () => {
    const label = await vscode.window.showInputBox({
      prompt: 'Group name',
      placeHolder: 'e.g. Projects',
      validateInput: v => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (!label) {
      return;
    }
    await store.addGroup(label.trim());
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.renameGroup', async (node?: Node) => {
    if (node?.kind !== 'group') {
      return;
    }
    const newLabel = await vscode.window.showInputBox({
      prompt: 'New group name',
      value: node.group.label,
      validateInput: v => (v.trim() ? undefined : 'Name cannot be empty'),
    });
    if (!newLabel) {
      return;
    }
    await store.renameGroup(node.group.id, newLabel.trim());
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.deleteGroup', async (node?: Node) => {
    if (node?.kind !== 'group') {
      return;
    }
    const count = store.bookmarksInGroup(node.group.id).length;
    const choices: vscode.QuickPickItem[] = count === 0
      ? [{ label: '$(trash) Delete group', description: 'Group is empty' }]
      : [
          { label: '$(move) Delete group, keep bookmarks', description: `${count} bookmark(s) move to top level` },
          { label: '$(trash) Delete group and bookmarks', description: `Removes ${count} bookmark(s) as well` },
          { label: '$(x) Cancel' },
        ];
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: `Delete "${node.group.label}"?` });
    if (!picked || picked.label.startsWith('$(x)')) {
      return;
    }
    const alsoRemoveBookmarks = picked.label.startsWith('$(trash) Delete group and');
    await store.removeGroup(node.group.id, alsoRemoveBookmarks);
  }));

  // --- Tree utility commands --------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.refresh', () => provider.refresh()));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.revealInOS', async (node?: Node) => {
    const target = nodePath(node);
    if (!target) {
      return;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.copyPath', async (node?: Node, selection?: Node[]) => {
    const paths = normalizeSelection(node, selection)
      .map(nodePath)
      .filter((p): p is string => !!p);
    if (paths.length === 0) {
      return;
    }
    await vscode.env.clipboard.writeText(paths.join('\n'));
    const preview = paths.length === 1 ? paths[0] : `${paths.length} paths`;
    vscode.window.setStatusBarMessage(`Copied: ${preview}`, 2000);
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.openInTerminal', async (node?: Node) => {
    const target = nodePath(node);
    if (!target) {
      return;
    }
    let cwd = target;
    if (node?.kind === 'file' || node?.kind === 'recent-file') {
      cwd = path.dirname(target);
    }
    vscode.window.createTerminal({ cwd }).show();
  }));

  // --- File open (records to recent) ------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.openFile', async (filePath: string) => {
    if (!filePath) {
      return;
    }
    await recent.record(filePath);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.clearRecent', async () => {
    await recent.clear();
  }));

  // --- File operations on tree items ------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.newFile', async (node?: Node) => {
    const dir = folderForNewChild(node);
    if (!dir) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `New file in ${collapseHome(dir)}`,
      placeHolder: 'filename.ext',
      validateInput: v => validateName(v),
    });
    if (!name) {
      return;
    }
    const target = path.join(dir, name.trim());
    if (await pathExists(target)) {
      vscode.window.showErrorMessage(`Already exists: ${target}`);
      return;
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new Uint8Array());
    await vscode.commands.executeCommand('dilopsFileBrowser.openFile', target);
    provider.refresh();
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.newFolder', async (node?: Node) => {
    const dir = folderForNewChild(node);
    if (!dir) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: `New folder in ${collapseHome(dir)}`,
      placeHolder: 'folder-name',
      validateInput: v => validateName(v),
    });
    if (!name) {
      return;
    }
    const target = path.join(dir, name.trim());
    if (await pathExists(target)) {
      vscode.window.showErrorMessage(`Already exists: ${target}`);
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(target));
    provider.refresh();
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.rename', async (node?: Node) => {
    const target = nodePath(node);
    if (!target || node?.kind === 'bookmark' || node?.kind === 'group' || node?.kind === 'recent-file') {
      return;
    }
    const dir = path.dirname(target);
    const oldName = path.basename(target);
    const newName = await vscode.window.showInputBox({
      prompt: 'New name',
      value: oldName,
      validateInput: v => validateName(v),
    });
    if (!newName || newName.trim() === oldName) {
      return;
    }
    const dest = path.join(dir, newName.trim());
    if (await pathExists(dest)) {
      vscode.window.showErrorMessage(`Already exists: ${dest}`);
      return;
    }
    await vscode.workspace.fs.rename(vscode.Uri.file(target), vscode.Uri.file(dest));
    provider.refresh();
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.delete', async (node?: Node, selection?: Node[]) => {
    const targets = normalizeSelection(node, selection)
      .filter(n => n.kind === 'file' || n.kind === 'folder')
      .map(n => (n as { path: string }).path);
    if (targets.length === 0) {
      return;
    }
    await deleteTargets(targets);
    provider.refresh();
  }));

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.duplicate', async (node?: Node, selection?: Node[]) => {
    const targets = normalizeSelection(node, selection)
      .filter(n => n.kind === 'file' || n.kind === 'folder')
      .map(n => (n as { path: string }).path);
    if (targets.length === 0) {
      return;
    }
    for (const t of targets) {
      const dest = await deriveDuplicatePath(t);
      if (!dest) {
        continue;
      }
      try {
        await vscode.workspace.fs.copy(vscode.Uri.file(t), vscode.Uri.file(dest), { overwrite: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to duplicate ${t}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    provider.refresh();
  }));

  // --- Fuzzy search -----------------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.searchInBookmark', async (node?: Node) => {
    let rootPath: string | undefined;
    let rootLabel: string | undefined;
    if (node?.kind === 'bookmark') {
      rootPath = node.bookmark.path;
      rootLabel = node.bookmark.label;
    } else if (node?.kind === 'folder') {
      rootPath = node.path;
      rootLabel = path.basename(node.path);
    } else {
      const bookmarks = store.listBookmarks();
      if (bookmarks.length === 0) {
        vscode.window.showInformationMessage('Add a bookmark before searching.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        bookmarks.map(b => ({ label: b.label, description: b.path, path: b.path })),
        { placeHolder: 'Search within which bookmark?' },
      );
      if (!pick) {
        return;
      }
      rootPath = pick.path;
      rootLabel = pick.label;
    }
    await searchBookmark(rootPath, rootLabel);
  }));

  // --- Sort By ----------------------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.sortBy', async () => {
    type SortChoice = vscode.QuickPickItem & { sortBy: 'name' | 'modified' | 'size'; direction: 'asc' | 'desc' };
    const config = vscode.workspace.getConfiguration('dilopsFileBrowser');
    const currentBy = config.get<string>('sortBy', 'name');
    const currentDir = config.get<string>('sortDirection', 'asc');
    const mark = (by: string, dir: string): string => (by === currentBy && dir === currentDir ? '$(check) ' : '     ');
    const items: SortChoice[] = [
      { label: `${mark('name', 'asc')}Name  A → Z`, sortBy: 'name', direction: 'asc' },
      { label: `${mark('name', 'desc')}Name  Z → A`, sortBy: 'name', direction: 'desc' },
      { label: `${mark('modified', 'desc')}Modified  newest first`, sortBy: 'modified', direction: 'desc' },
      { label: `${mark('modified', 'asc')}Modified  oldest first`, sortBy: 'modified', direction: 'asc' },
      { label: `${mark('size', 'desc')}Size  largest first`, sortBy: 'size', direction: 'desc' },
      { label: `${mark('size', 'asc')}Size  smallest first`, sortBy: 'size', direction: 'asc' },
    ];
    const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Sort files by…' });
    if (!chosen) {
      return;
    }
    await config.update('sortBy', chosen.sortBy, vscode.ConfigurationTarget.Global);
    await config.update('sortDirection', chosen.direction, vscode.ConfigurationTarget.Global);
  }));

  // --- Go To Path -------------------------------------------------------

  sub.push(vscode.commands.registerCommand('dilopsFileBrowser.goToPath', async () => {
    const input = await vscode.window.showInputBox({
      prompt: 'Reveal path in File Browser',
      placeHolder: '/shares/nfs/dil/development/… or ~/projects/foo',
      validateInput: v => (v.trim() ? undefined : 'Path is required'),
    });
    if (!input) {
      return;
    }
    const target = expandHome(input.trim());
    if (!(await pathExists(target))) {
      vscode.window.showErrorMessage(`Path not found: ${target}`);
      return;
    }
    await revealPath(store, provider, treeView, target);
  }));
}

// --- helpers ----------------------------------------------------------

let trashUnsupported = false;

async function deleteTargets(targets: string[]): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  if (!trashUnsupported) {
    const confirm = await promptDelete(targets, /* permanent */ false);
    if (!confirm) {
      return;
    }
    const trashOutcome = await tryDeleteBatch(targets, /* useTrash */ true);
    if (!trashOutcome.trashUnsupported) {
      return;
    }
    trashUnsupported = true;
    // Fall through to the permanent-delete branch for the surviving items.
    const remaining = trashOutcome.remaining;
    if (remaining.length === 0) {
      return;
    }
    const escalate = await vscode.window.showWarningMessage(
      `Trash isn't available on this Remote SSH connection.\n\nPermanently delete ${remaining.length === 1 ? collapseHome(remaining[0]) : `${remaining.length} item(s)`}?`,
      { modal: true },
      'Permanently Delete',
    );
    if (escalate !== 'Permanently Delete') {
      return;
    }
    await tryDeleteBatch(remaining, /* useTrash */ false);
    return;
  }

  // We already know trash is unsupported this session — one confirm, then permanent.
  const confirm = await promptDelete(targets, /* permanent */ true);
  if (!confirm) {
    return;
  }
  await tryDeleteBatch(targets, /* useTrash */ false);
}

async function promptDelete(targets: string[], permanent: boolean): Promise<boolean> {
  const verb = permanent ? 'Permanently delete' : 'Move to trash';
  const button = permanent ? 'Permanently Delete' : 'Move to Trash';
  const label = targets.length === 1
    ? `${verb}: ${collapseHome(targets[0])}?`
    : `${verb} ${targets.length} items?\n\n${targets.slice(0, 8).map(collapseHome).join('\n')}${targets.length > 8 ? `\n… and ${targets.length - 8} more` : ''}`;
  const choice = await vscode.window.showWarningMessage(label, { modal: true }, button);
  return choice === button;
}

async function tryDeleteBatch(
  targets: string[],
  useTrash: boolean,
): Promise<{ trashUnsupported: boolean; remaining: string[] }> {
  const remaining: string[] = [];
  let detectedUnsupported = false;
  for (const t of targets) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(t), { recursive: true, useTrash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (useTrash && isTrashUnsupported(msg)) {
        detectedUnsupported = true;
        remaining.push(t);
        continue;
      }
      vscode.window.showErrorMessage(`Failed to delete ${t}: ${msg}`);
    }
  }
  return { trashUnsupported: detectedUnsupported, remaining };
}

function isTrashUnsupported(message: string): boolean {
  return /trash|provider does not support/i.test(message);
}

function normalizeSelection(clicked: Node | undefined, selection: Node[] | undefined): Node[] {
  if (selection && selection.length > 0) {
    // If the user right-clicked an unselected item, VS Code still includes the clicked item
    // in `selection`. But to be defensive, ensure `clicked` is present.
    if (clicked && !selection.includes(clicked)) {
      return [clicked, ...selection];
    }
    return [...selection];
  }
  return clicked ? [clicked] : [];
}

function pickBookmarks(clicked: Node | undefined, selection: Node[] | undefined): Array<Extract<Node, { kind: 'bookmark' }>['bookmark']> {
  return normalizeSelection(clicked, selection)
    .filter((n): n is Extract<Node, { kind: 'bookmark' }> => n.kind === 'bookmark')
    .map(n => n.bookmark);
}

function nodePath(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  switch (node.kind) {
    case 'bookmark':
      return node.bookmark.path;
    case 'folder':
    case 'file':
      return node.path;
    case 'recent-file':
      return node.path;
    default:
      return undefined;
  }
}

function folderForNewChild(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.kind === 'folder') {
    return node.path;
  }
  if (node.kind === 'bookmark') {
    return node.bookmark.path;
  }
  if (node.kind === 'file') {
    return path.dirname(node.path);
  }
  return undefined;
}

function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Name cannot be empty';
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'Name cannot contain slashes';
  }
  if (trimmed === '.' || trimmed === '..') {
    return 'Invalid name';
  }
  return undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function deriveDuplicatePath(source: string): Promise<string | undefined> {
  const dir = path.dirname(source);
  const base = path.basename(source);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let i = 1; i < 100; i++) {
    const candidate = path.join(dir, `${stem} (copy${i === 1 ? '' : ` ${i}`})${ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

function expandHome(input: string): string {
  const home = process.env.HOME;
  if (!home) {
    return path.resolve(input);
  }
  if (input === '~') {
    return home;
  }
  if (input.startsWith('~/')) {
    return path.resolve(path.join(home, input.slice(2)));
  }
  return path.resolve(input);
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

async function revealPath(
  store: BookmarkStore,
  provider: BookmarkProvider,
  treeView: vscode.TreeView<Node>,
  target: string,
): Promise<void> {
  const bookmarks = store.listBookmarks();
  const owner = bookmarks
    .filter(b => target === b.path || target.startsWith(b.path + path.sep))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (!owner) {
    const containing = (await isDirectory(target)) ? target : path.dirname(target);
    const add = await vscode.window.showInformationMessage(
      `${target} is not under any bookmark. Bookmark ${collapseHome(containing)}?`,
      'Bookmark It',
      'Cancel',
    );
    if (add === 'Bookmark It') {
      await store.addBookmark(containing);
      await revealPath(store, provider, treeView, target);
    }
    return;
  }

  const isDir = await isDirectory(target);
  const node: Node = target === owner.path
    ? { kind: 'bookmark', bookmark: owner }
    : isDir
      ? { kind: 'folder', path: target, label: path.basename(target), bookmarkRoot: owner.path }
      : { kind: 'file', path: target, label: path.basename(target), bookmarkRoot: owner.path };

  try {
    await treeView.reveal(node, { expand: 3, focus: true, select: true });
  } catch {
    // reveal can fail if the target is not currently in the tree — do best-effort refresh.
    provider.refresh();
  }

  if (node.kind === 'file') {
    await vscode.commands.executeCommand('dilopsFileBrowser.openFile', target);
  }
}
