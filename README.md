# Roam

Bookmark and browse any directory on disk — a native VS Code / Positron
sidebar file explorer that isn't confined to the workspace root.

VS Code's built-in Explorer is workspace-centric: everything you see is
rooted at one folder. Roam adds a second sidebar view where you can pin
any path (`~/`, `/mnt/data/`, a share, wherever) as its own bookmark
tree — with the same native styling, file-icon theme, and drag-and-drop
as the built-in Explorer.

## Features

- **Bookmarks & groups** — pin any directory as a top-level entry.
  Organize bookmarks into groups; drag or Move Up / Move Down to
  reorder.
- **Recent files** — a pinned section at the top of the tree tracks
  the last 20 files opened through Roam.
- **File operations on any tree item** — New File / New Folder / Rename
  / Duplicate / Delete. Cross-directory Copy / Cut / Paste with
  unique-name resolution.
- **Multi-select bulk ops** — delete, copy, or duplicate several files
  at once. Delete falls back to permanent delete when the OS trash
  provider is unavailable (e.g. Remote SSH).
- **Fuzzy search** — right-click a bookmark or folder → Search Files…
  gives you a live QuickPick over its full contents.
- **Go To Path** — command-palette entry that expands the tree straight
  to any path (with `~/` expansion). Offers to bookmark it if it isn't
  under one already.
- **Git decorations** — files show M / A / D / U badges and the
  matching colours from your theme, powered by the built-in git
  extension.
- **Git branch on bookmarks** — bookmarks that point at a repo root
  show the current branch in their description.
- **Project-type and Slurm badges** — folders containing `renv.lock`,
  `pyproject.toml`, `_targets.R`, or `.git` get a coloured letter
  badge; files matching `slurm-*.out|err` get an orange **S**.
- **Sort by name / modified / size** with an ascending / descending
  toggle. Modified time and size render inline via configurable
  toggles (calendar / 123 icons in the title bar).
- **Live refresh** — expanded directories poll for external changes
  (created / removed files) so new output appears without hitting
  Refresh. Uses `fs.watch` when it works and polls otherwise —
  necessary on NFS where inotify isn't reliable.
- **Upload from your computer** — drag a file from Finder / File
  Explorer onto a bookmark or folder to upload it. Works over Remote
  SSH: bytes stream from your client to the remote host.
- **Download to your computer** — right-click any file → Download to
  My Computer… Serves the file over a per-download ephemeral local
  HTTP tunnel (via `asExternalUri`) so your client browser saves it
  normally. Files > 512 MB / folders fall back to a copyable `scp`
  command.
- **Open folder as workspace** — three flavours: replace current,
  open in new window, or add as an additional workspace root.
- **Run this file** — configurable per-extension run templates
  (`Rscript ${file}`, `python ${file}`, etc.) fire in a new terminal
  at the file's directory.

## Install

```sh
npm install
npm run compile
npm run package     # produces roam.vsix
```

Then in VS Code / Positron: `Ctrl+Shift+P` → `Extensions: Install from VSIX…`
and pick the generated `.vsix`. Reload the window.

Roam also handles being installed on a remote (Remote SSH) host — VS Code
carries the extension across and every feature works from the extension
host on the remote side.

## Development

```sh
npm install
npm run watch       # incremental compile
```

Then press **F5** in the extension's project window to launch an
Extension Development Host with Roam loaded. Iterate live; when done,
`npm run package` produces a fresh `.vsix`.

## Settings

| Setting                            | Default    | What it does                              |
| ---                                | ---        | ---                                       |
| `roam.showHiddenFiles`             | `false`    | Show dotfiles / dotdirs.                  |
| `roam.foldersFirst`                | `true`     | Group folders above files in each dir.    |
| `roam.respectFilesExclude`         | `true`     | Honor workspace `files.exclude` globs.    |
| `roam.sortBy`                      | `name`     | `name` / `modified` / `size`.             |
| `roam.sortDirection`               | `asc`      | `asc` / `desc`.                           |
| `roam.showModified`                | `true`     | Show mtime in the description slot.       |
| `roam.modifiedFormat`              | `compact`  | `compact` (e.g. `2h`) or `relative`.      |
| `roam.showSize`                    | `false`    | Show file size in the description slot.   |
| `roam.showBookmarkDiskUsage`       | `false`    | `du -sb` per bookmark. Expensive on NFS.  |
| `roam.watchPollingIntervalMs`      | `3000`     | Live-refresh polling cadence (min 500).   |
| `roam.runners`                     | see below  | Extension → command template map.         |

Default `roam.runners`:

```json
{
  ".R":    "Rscript ${file}",
  ".Rmd":  "R -e \"rmarkdown::render('${file}')\"",
  ".py":   "python ${file}",
  ".sh":   "bash ${file}",
  ".bash": "bash ${file}",
  ".qmd":  "quarto render ${file}"
}
```

`${file}` is shell-quoted safely at runtime. Templates run in a new
terminal cd'd to the file's directory — so if your project needs a
specific module or venv loaded, put that in your shell's startup file
(`.zshrc`, `.bashrc`) or override the template.

## License

MIT.
