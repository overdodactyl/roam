import * as vscode from 'vscode';

interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
  repositories: GitRepository[];
}

interface GitRepository {
  state: {
    workingTreeChanges: Array<{ uri: vscode.Uri; status: number }>;
    indexChanges: Array<{ uri: vscode.Uri; status: number }>;
    untrackedChanges?: Array<{ uri: vscode.Uri; status: number }>;
    HEAD?: { name?: string; commit?: string };
    onDidChange: vscode.Event<void>;
  };
  rootUri: vscode.Uri;
}

/**
 * Lookup helpers so other providers (e.g. bookmark labels) can consult
 * git state without going through the decoration provider directly.
 */
export interface GitLookup {
  getBranch(fsPath: string): string | undefined;
  onDidChangeBranch: vscode.Event<void>;
}

const STATUS_INDEX_MODIFIED = 0;
const STATUS_INDEX_ADDED = 1;
const STATUS_INDEX_DELETED = 2;
const STATUS_MODIFIED = 5;
const STATUS_DELETED = 6;
const STATUS_UNTRACKED = 7;
const STATUS_IGNORED = 8;

export class GitDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable, GitLookup {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private readonly _onDidChangeBranch = new vscode.EventEmitter<void>();
  readonly onDidChangeBranch = this._onDidChangeBranch.event;

  private gitApi: GitApi | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.tryConnect();
  }

  private tryConnect(): void {
    const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    if (!ext) {
      return;
    }
    const attach = (): void => {
      try {
        this.gitApi = ext.exports.getAPI(1);
        this.subscribe();
      } catch {
        /* git ext not ready yet — retry on activation event below */
      }
    };
    if (ext.isActive) {
      attach();
    } else {
      ext.activate().then(attach, () => {
        /* ignore */
      });
    }
  }

  private subscribe(): void {
    if (!this.gitApi) {
      return;
    }
    const notifyAll = (): void => {
      this._onDidChange.fire(undefined);
      this._onDidChangeBranch.fire();
    };
    for (const repo of this.gitApi.repositories) {
      this.disposables.push(repo.state.onDidChange(notifyAll));
    }
    this.disposables.push(this.gitApi.onDidOpenRepository(repo => {
      this.disposables.push(repo.state.onDidChange(notifyAll));
      notifyAll();
    }));
    this.disposables.push(this.gitApi.onDidCloseRepository(() => notifyAll()));
    notifyAll();
  }

  getBranch(fsPath: string): string | undefined {
    if (!this.gitApi) {
      return undefined;
    }
    const repo = this.gitApi.getRepository(vscode.Uri.file(fsPath));
    return repo?.state.HEAD?.name;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this.gitApi || uri.scheme !== 'file') {
      return undefined;
    }
    const repo = this.gitApi.getRepository(uri);
    if (!repo) {
      return undefined;
    }
    const target = uri.fsPath;
    const changes = [
      ...repo.state.workingTreeChanges,
      ...repo.state.indexChanges,
      ...(repo.state.untrackedChanges ?? []),
    ];
    for (const change of changes) {
      if (change.uri.fsPath === target) {
        return decorate(change.status);
      }
    }
    return undefined;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this._onDidChange.dispose();
  }
}

function decorate(status: number): vscode.FileDecoration | undefined {
  switch (status) {
    case STATUS_INDEX_MODIFIED:
    case STATUS_MODIFIED:
      return { badge: 'M', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'), tooltip: 'Modified' };
    case STATUS_INDEX_ADDED:
      return { badge: 'A', color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'), tooltip: 'Added' };
    case STATUS_INDEX_DELETED:
    case STATUS_DELETED:
      return { badge: 'D', color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'), tooltip: 'Deleted' };
    case STATUS_UNTRACKED:
      return { badge: 'U', color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'), tooltip: 'Untracked' };
    case STATUS_IGNORED:
      return { color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'), tooltip: 'Ignored' };
    default:
      return undefined;
  }
}
