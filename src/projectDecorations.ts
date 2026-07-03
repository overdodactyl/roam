import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface FolderMarker {
  file: string;
  badge: string;
  tooltip: string;
  color: string;
}

const FOLDER_MARKERS: FolderMarker[] = [
  { file: 'renv.lock',      badge: 'R', tooltip: 'R project (renv)',       color: 'charts.blue' },
  { file: 'pyproject.toml', badge: 'P', tooltip: 'Python project',         color: 'charts.yellow' },
  { file: '_targets.R',     badge: 'T', tooltip: 'targets pipeline',       color: 'charts.purple' },
];

const SLURM_FILE_RE = /^slurm-.*\.(out|err)$/i;

export class ProjectDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }

    const p = uri.fsPath;
    const basename = path.basename(p);

    // Files: highlight Slurm output.
    if (SLURM_FILE_RE.test(basename)) {
      return {
        badge: 'S',
        tooltip: 'Slurm job output',
        color: new vscode.ThemeColor('charts.orange'),
      };
    }

    // Folders: check for project markers. Fast path: only stat if it exists.
    let isDir: boolean;
    try {
      isDir = fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
    } catch {
      return undefined;
    }
    if (!isDir) {
      return undefined;
    }

    // .git as a subdirectory
    if (existsQuick(path.join(p, '.git'))) {
      return { badge: 'G', tooltip: 'Git repository', color: new vscode.ThemeColor('charts.green') };
    }

    for (const marker of FOLDER_MARKERS) {
      if (existsQuick(path.join(p, marker.file))) {
        return {
          badge: marker.badge,
          tooltip: marker.tooltip,
          color: new vscode.ThemeColor(marker.color),
        };
      }
    }

    return undefined;
  }
}

function existsQuick(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}
