import * as vscode from 'vscode';
import * as path from 'path';

export interface Bookmark {
  id: string;
  label: string;
  path: string;
  groupId?: string;
  order?: number;
}

export interface Group {
  id: string;
  label: string;
  order?: number;
}

const BOOKMARKS_KEY = 'dilopsFileBrowser.bookmarks';
const GROUPS_KEY = 'dilopsFileBrowser.groups';

export class BookmarkStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  listBookmarks(): Bookmark[] {
    const bookmarks = this.context.globalState.get<Bookmark[]>(BOOKMARKS_KEY, []);
    return [...bookmarks].sort(compareOrder);
  }

  listGroups(): Group[] {
    const groups = this.context.globalState.get<Group[]>(GROUPS_KEY, []);
    return [...groups].sort(compareOrder);
  }

  bookmarksInGroup(groupId: string | undefined): Bookmark[] {
    return this.listBookmarks().filter(b => (b.groupId ?? undefined) === groupId);
  }

  findBookmark(id: string): Bookmark | undefined {
    return this.listBookmarks().find(b => b.id === id);
  }

  findGroup(id: string): Group | undefined {
    return this.listGroups().find(g => g.id === id);
  }

  async addBookmark(dirPath: string, label?: string, groupId?: string): Promise<Bookmark> {
    const normalized = path.resolve(dirPath);
    const bookmarks = this.listBookmarks();
    const existing = bookmarks.find(b => b.path === normalized);
    if (existing) {
      if (groupId !== undefined && existing.groupId !== groupId) {
        existing.groupId = groupId;
        await this.persistBookmarks(bookmarks);
      }
      return existing;
    }
    const bookmark: Bookmark = {
      id: mkId('bm'),
      label: label ?? (path.basename(normalized) || normalized),
      path: normalized,
      groupId,
      order: nextOrder(bookmarks),
    };
    bookmarks.push(bookmark);
    await this.persistBookmarks(bookmarks);
    return bookmark;
  }

  async removeBookmark(id: string): Promise<void> {
    const filtered = this.listBookmarks().filter(b => b.id !== id);
    await this.persistBookmarks(filtered);
  }

  async renameBookmark(id: string, newLabel: string): Promise<void> {
    const bookmarks = this.listBookmarks();
    const target = bookmarks.find(b => b.id === id);
    if (!target) {
      return;
    }
    target.label = newLabel;
    await this.persistBookmarks(bookmarks);
  }

  async moveBookmarkToGroup(id: string, groupId: string | undefined): Promise<void> {
    const bookmarks = this.listBookmarks();
    const target = bookmarks.find(b => b.id === id);
    if (!target) {
      return;
    }
    target.groupId = groupId;
    await this.persistBookmarks(bookmarks);
  }

  async reorderBookmarks(orderedIds: string[]): Promise<void> {
    const bookmarks = this.listBookmarks();
    const map = new Map(bookmarks.map(b => [b.id, b]));
    orderedIds.forEach((id, index) => {
      const bm = map.get(id);
      if (bm) {
        bm.order = index;
      }
    });
    await this.persistBookmarks([...map.values()]);
  }

  async addGroup(label: string): Promise<Group> {
    const groups = this.listGroups();
    const group: Group = {
      id: mkId('grp'),
      label,
      order: nextOrder(groups),
    };
    groups.push(group);
    await this.persistGroups(groups);
    return group;
  }

  async removeGroup(id: string, alsoRemoveBookmarks: boolean): Promise<void> {
    const groups = this.listGroups().filter(g => g.id !== id);
    let bookmarks = this.listBookmarks();
    if (alsoRemoveBookmarks) {
      bookmarks = bookmarks.filter(b => b.groupId !== id);
    } else {
      bookmarks = bookmarks.map(b => (b.groupId === id ? { ...b, groupId: undefined } : b));
    }
    await this.persistGroups(groups);
    await this.persistBookmarks(bookmarks);
  }

  async renameGroup(id: string, newLabel: string): Promise<void> {
    const groups = this.listGroups();
    const target = groups.find(g => g.id === id);
    if (!target) {
      return;
    }
    target.label = newLabel;
    await this.persistGroups(groups);
  }

  private async persistBookmarks(bookmarks: Bookmark[]): Promise<void> {
    await this.context.globalState.update(BOOKMARKS_KEY, bookmarks);
    this._onDidChange.fire();
  }

  private async persistGroups(groups: Group[]): Promise<void> {
    await this.context.globalState.update(GROUPS_KEY, groups);
    this._onDidChange.fire();
  }
}

function compareOrder<T extends { order?: number; label: string }>(a: T, b: T): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) {
    return ao - bo;
  }
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function nextOrder(items: Array<{ order?: number }>): number {
  const max = items.reduce((acc, i) => Math.max(acc, i.order ?? -1), -1);
  return max + 1;
}

function mkId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
