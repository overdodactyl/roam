import * as vscode from 'vscode';
import { BookmarkStore } from './bookmarks';
import { Node } from './bookmarkProvider';

const MIME = 'application/vnd.code.tree.dilopsfilebrowser.bookmarks';

export class BookmarkDragAndDropController implements vscode.TreeDragAndDropController<Node> {
  readonly dropMimeTypes = [MIME];
  readonly dragMimeTypes = [MIME];

  constructor(private readonly store: BookmarkStore) {}

  handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): void {
    const bookmarkIds = source
      .filter((n): n is Extract<Node, { kind: 'bookmark' }> => n.kind === 'bookmark')
      .map(n => n.bookmark.id);
    if (bookmarkIds.length === 0) {
      return;
    }
    dataTransfer.set(MIME, new vscode.DataTransferItem(JSON.stringify(bookmarkIds)));
  }

  async handleDrop(target: Node | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(MIME);
    if (!item) {
      return;
    }
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

    // Dropped on nothing / recent section — move to ungrouped, at the end.
    for (const id of draggedIds) {
      await this.store.moveBookmarkToGroup(id, undefined);
    }
    await this.reorderPreservingGroups(draggedIds, undefined);
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
