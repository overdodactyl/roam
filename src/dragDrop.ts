import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BookmarkStore } from './bookmarks';
import { Node } from './bookmarkProvider';
import { log } from './logger';

const INTERNAL_MIME = 'application/vnd.code.tree.dilopsfilebrowser.bookmarks';
const URI_LIST_MIME = 'text/uri-list';

export class BookmarkDragAndDropController implements vscode.TreeDragAndDropController<Node> {
  readonly dropMimeTypes = [INTERNAL_MIME, URI_LIST_MIME, 'application/vnd.code.uri-list', 'files'];
  readonly dragMimeTypes = [INTERNAL_MIME];

  constructor(
    private readonly store: BookmarkStore,
    private readonly refresh: () => void,
  ) {}

  handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): void {
    const bookmarkIds = source
      .filter((n): n is Extract<Node, { kind: 'bookmark' }> => n.kind === 'bookmark')
      .map(n => n.bookmark.id);
    if (bookmarkIds.length === 0) {
      return;
    }
    dataTransfer.set(INTERNAL_MIME, new vscode.DataTransferItem(JSON.stringify(bookmarkIds)));
  }

  async handleDrop(target: Node | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Priority 1: internal bookmark drag (reorder / group).
    const internal = dataTransfer.get(INTERNAL_MIME);
    if (internal) {
      await this.handleInternalDrop(target, internal);
      return;
    }

    // Priority 2: OS file drop or cross-view URI drop. Both land here.
    const destDir = folderTarget(target);
    if (!destDir) {
      vscode.window.showInformationMessage('Drop files onto a bookmark or folder.');
      return;
    }
    await this.handleExternalDrop(destDir, dataTransfer);
  }

  private async handleInternalDrop(target: Node | undefined, item: vscode.DataTransferItem): Promise<void> {
    let draggedIds: string[];
    try {
      draggedIds = JSON.parse(await item.asString()) as string[];
    } catch {
      return;
    }
    if (!Array.isArray(draggedIds) || draggedIds.length === 0) {
      return;
    }

    if (target?.kind === 'group') {
      for (const id of draggedIds) {
        await this.store.moveBookmarkToGroup(id, target.group.id);
      }
      await this.reorderPreservingGroups(draggedIds, undefined);
      return;
    }

    if (target?.kind === 'bookmark') {
      for (const id of draggedIds) {
        await this.store.moveBookmarkToGroup(id, target.bookmark.groupId);
      }
      await this.reorderPreservingGroups(draggedIds, target.bookmark.id);
      return;
    }

    for (const id of draggedIds) {
      await this.store.moveBookmarkToGroup(id, undefined);
    }
    await this.reorderPreservingGroups(draggedIds, undefined);
  }

  private async handleExternalDrop(destDir: string, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Collect the two flavors of drop content:
    //   files: DataTransferFile[] — raw bytes (works over Remote SSH from the client machine)
    //   uris:  vscode.Uri[]        — text/uri-list, only readable if on the extension host's FS
    const files: vscode.DataTransferFile[] = [];
    const uris: vscode.Uri[] = [];

    dataTransfer.forEach((item, mime) => {
      const file = item.asFile();
      if (file) {
        files.push(file);
      } else if (mime === URI_LIST_MIME || mime === 'application/vnd.code.uri-list') {
        // Deferred: string parsing needs an await, do it below.
      }
    });

    const uriListItem = dataTransfer.get(URI_LIST_MIME) ?? dataTransfer.get('application/vnd.code.uri-list');
    if (uriListItem && files.length === 0) {
      try {
        const raw = await uriListItem.asString();
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            continue;
          }
          try {
            uris.push(vscode.Uri.parse(trimmed));
          } catch {
            /* skip malformed */
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (files.length === 0 && uris.length === 0) {
      log(`external drop on ${destDir}: no files or URIs found in transfer`);
      return;
    }

    const total = files.length + uris.length;
    log(`external drop on ${destDir}: ${files.length} file(s), ${uris.length} uri(s)`);

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Uploading to ${collapseHome(destDir)}`,
      cancellable: false,
    }, async progress => {
      let done = 0;
      const tick = (name: string): void => {
        done++;
        progress.report({ message: `${done}/${total}: ${name}`, increment: 100 / total });
      };

      for (const file of files) {
        try {
          const bytes = await file.data();
          const dest = await uniqueDestPath(destDir, file.name);
          await vscode.workspace.fs.writeFile(vscode.Uri.file(dest), bytes);
          tick(file.name);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const uri of uris) {
        try {
          const name = path.basename(uri.fsPath || uri.path);
          const dest = await uniqueDestPath(destDir, name);
          await vscode.workspace.fs.copy(uri, vscode.Uri.file(dest), { overwrite: false });
          tick(name);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to copy ${uri.toString()}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    this.refresh();
  }

  private async reorderPreservingGroups(
    draggedIds: string[],
    insertBeforeId: string | undefined,
  ): Promise<void> {
    const bookmarks = this.store.listBookmarks();
    const dragged = draggedIds
      .map(id => bookmarks.find(b => b.id === id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    const rest = bookmarks.filter(b => !draggedIds.includes(b.id));

    const insertIndex = insertBeforeId
      ? rest.findIndex(b => b.id === insertBeforeId)
      : rest.length;
    const finalOrder = [
      ...rest.slice(0, insertIndex === -1 ? rest.length : insertIndex),
      ...dragged,
      ...rest.slice(insertIndex === -1 ? rest.length : insertIndex),
    ];

    await this.store.reorderBookmarks(finalOrder.map(b => b.id));
  }
}

function folderTarget(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.kind === 'bookmark') {
    return node.bookmark.path;
  }
  if (node.kind === 'folder') {
    return node.path;
  }
  if (node.kind === 'file') {
    return path.dirname(node.path);
  }
  return undefined;
}

async function uniqueDestPath(destDir: string, name: string): Promise<string> {
  let candidate = path.join(destDir, name);
  if (!(await pathExists(candidate))) {
    return candidate;
  }
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(destDir, `${stem} (${i})${ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`Cannot find a unique name for ${name} in ${destDir}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
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
