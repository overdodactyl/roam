# Roam

[![Open VSX Version](https://img.shields.io/open-vsx/v/overdodactyl/roam?label=Open%20VSX)](https://open-vsx.org/extension/overdodactyl/roam)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/overdodactyl/roam)](https://open-vsx.org/extension/overdodactyl/roam)
[![CI](https://github.com/overdodactyl/roam/actions/workflows/ci.yml/badge.svg)](https://github.com/overdodactyl/roam/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Bookmark and browse any directory on disk.** Roam adds a native sidebar
file explorer to VS Code and Positron that isn't confined to your
workspace root — pin any path (`~/`, a mounted share, an unrelated
project) as its own tree and browse, edit, upload, download, and
navigate to it without leaving the editor.

Uses the same native `TreeView` widget as the built-in Explorer, so it
inherits your file icon theme and git decorations for free.

---

## Features

**Bookmarks & organization**
- Pin any directory as a top-level bookmark; expand as a lazy tree.
- Group bookmarks into named collections.
- Reorder with drag-and-drop or explicit Move Up / Move Down.
- First-run seed adds `$HOME` automatically.

**Navigation**
- Fuzzy filename search scoped to any bookmark or folder.
- Go To Path — type any path (with `~/` expansion) and jump the tree
  straight to it, expanding ancestors.
- Reveal Active Editor File in the tree with one command.
- Recent Files section pins the last 20 files you opened.

**File operations**
- New File, New Folder, Rename, Duplicate, Delete (to trash — or
  permanent delete with a second confirm when trash isn't available,
  which is the case over Remote SSH).
- Cross-directory Copy / Cut / Paste, with automatic name collision
  handling.
- Multi-select for bulk delete, duplicate, copy-path, remove-bookmark.

**Signals baked into the tree**
- Git decorations (M / A / D / U with theme colors).
- Git branch shown on bookmarks pointing at a repo root.
- Project-type badges — folders with `renv.lock` (R), `pyproject.toml`
  (P), `_targets.R` (T), or `.git` (G) get a distinct-colored letter.
- Slurm output detector — files matching `slurm-*.out|err` get an
  orange **S**.
- Modification time and file size in the description slot, each
  toggled with a title-bar button.

**Sort, filter, hide**
- Sort by name, modified, or size. Ascending or descending.
- File-type filter (`.R,.py,.qmd,…`) with common presets and a custom
  option.
- Toggle hidden files (dotfiles), modified dates, and file sizes on
  and off from the title bar.
- Honors workspace `files.exclude` (matched relative to each bookmark).
- Auto-hides NetApp `.snapshot/` directories.

**Live refresh**
- External file changes (Slurm output, `mv` from a shell, `git checkout`)
  appear in the tree without a manual refresh.
- Uses `fs.watch` where reliable and falls back to a periodic
  `readdir`-diff poll on NFS. Configurable interval.

**Remote SSH file transfer**
- **Upload** — drag files from Finder / File Explorer onto a bookmark
  or folder. Bytes stream from your local machine to the remote host.
- **Download** — right-click a file → Download to My Computer. Serves
  the file over an ephemeral local HTTP tunnel; your OS browser saves
  it to your Downloads folder.
- Files > 512 MB and folders fall back to a copyable `scp` command
  built from the current SSH host.

**Workspace integration**
- Open Folder / Open in New Window / Add to Workspace on any bookmark
  or folder — the SSH remote follows automatically.
- Run This File on `.R` / `.py` / `.sh` / `.qmd` / `.Rmd` via
  configurable per-extension command templates. Runs in a new terminal
  at the file's directory.

---

## Install

Roam is published on [Open VSX](https://open-vsx.org/extension/overdodactyl/roam),
which is the extension marketplace used by Positron, VSCodium, Cursor,
and other editors that build on VS Code's core.

**Positron / VSCodium / Cursor / etc.**

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for `roam` (publisher: `overdodactyl`).
3. Click **Install**.

**VS Code (Microsoft build)**

VS Code's built-in extension search points at Microsoft's own marketplace,
not Open VSX. Grab the `.vsix` from the
[Open VSX release page](https://open-vsx.org/extension/overdodactyl/roam)
and install it via `Ctrl+Shift+P` → **Extensions: Install from VSIX…**.

**From source**

```sh
git clone https://github.com/overdodactyl/roam
cd roam
npm install
npm run compile
npm run package        # produces roam.vsix
```

Then `Ctrl+Shift+P` → **Extensions: Install from VSIX…** → pick
`roam.vsix`. Reload the window.

Roam is designed to run on remote hosts via Remote SSH — the editor
will carry it across and every feature (upload / download / live
refresh over NFS) works from there.

---

## Toolbar reference

Left to right, the title bar of the Roam view exposes:

| Icon              | Action                                         |
| ---               | ---                                            |
| `+`               | Add Bookmark… (folder picker)                  |
| target            | Reveal Active Editor File in the tree          |
| new-folder        | New Group…                                     |
| go-to-file        | Go To Path…                                    |
| filter            | Filter by File Type…                           |
| sort-precedence   | Sort By… (name / modified / size, asc / desc)  |
| calendar          | Show / Hide modified dates                     |
| symbol-numeric    | Show / Hide file sizes                         |
| eye / eye-closed  | Show / Hide hidden files (dotfiles)            |
| refresh           | Refresh the tree                               |

The dates, sizes, and hidden-files toggles all mirror their config
setting and update the button icon based on the current state.

---

## Command palette

All commands are prefixed with `Roam:`. Highlights:

- `Roam: Add Bookmark…` / `Roam: Add Bookmark by Path…`
- `Roam: New Group…`
- `Roam: Go To Path…`
- `Roam: Sort By…`
- `Roam: Filter by File Type…`
- `Roam: Reveal Active Editor File`
- `Roam: Clear Recent Files`
- `Roam: Refresh`
- `Roam: Show Log` — opens the diagnostics output channel.
- `Roam: Refresh Disk Usage (all bookmarks)`

Everything else is context-scoped (right-click actions in the tree).

---

## Settings

| Setting                       | Default   | What it does                                      |
| ---                           | ---       | ---                                               |
| `roam.showHiddenFiles`        | `false`   | Show dotfiles / dotdirs.                          |
| `roam.foldersFirst`           | `true`    | Group folders above files in each dir.            |
| `roam.respectFilesExclude`    | `true`    | Honor workspace `files.exclude` globs.            |
| `roam.sortBy`                 | `name`    | `name` / `modified` / `size`.                     |
| `roam.sortDirection`          | `asc`     | `asc` / `desc`.                                   |
| `roam.showModified`           | `true`    | Show mtime in the description slot.               |
| `roam.modifiedFormat`         | `compact` | `compact` (e.g. `2h`) or `relative` (`2h ago`).   |
| `roam.showSize`               | `false`   | Show file size in the description slot.           |
| `roam.showBookmarkDiskUsage`  | `false`   | `du -sb` per bookmark. Expensive on NFS.          |
| `roam.watchPollingIntervalMs` | `3000`    | Live-refresh polling cadence (min 500).           |
| `roam.runners`                | see below | Extension → command template map for Run File.    |

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
terminal `cd`'d to the file's directory — so if a project needs a
specific module or venv loaded, either put that in your shell's startup
file or override the template. E.g., to load a specific R module for
`.R` files on a Slurm-managed cluster:

```json
"roam.runners": {
  ".R": "module load R/4/4.2.2 && Rscript ${file}"
}
```

---

## Live refresh on NFS

`fs.watch` (inotify on Linux) does not reliably deliver events for
changes on NFS-mounted directories, so Roam uses a hybrid strategy:

- `fs.watch` gives near-instant refresh when it works (local FS, some
  network mounts).
- A periodic `readdir` poll (default every 3 s, configurable via
  `roam.watchPollingIntervalMs`) catches the changes `fs.watch` misses.
  The poll builds a `name:type` signature; a change fires the same
  refresh path.

Only expanded directories are polled, and bookmark paths themselves are
always watched — so a shell script writing to `~/` while the Home
bookmark is expanded will surface within one polling interval.

---

## Development

```sh
git clone https://github.com/overdodactyl/roam
cd roam
npm install
npm run watch          # incremental compile
```

Then press **F5** in your editor to launch an Extension Development
Host with Roam loaded. Iterate live; when done:

```sh
npm run package        # bundles roam.vsix
```

The source layout:

- `src/extension.ts` — entry point; wires everything together.
- `src/bookmarks.ts` / `src/recentFiles.ts` / `src/typeFilter.ts` —
  persistent stores backed by `globalState`.
- `src/bookmarkProvider.ts` — `TreeDataProvider`.
- `src/commands.ts` — every command handler.
- `src/dragDrop.ts` — bookmark reorder and OS-file upload.
- `src/directoryWatcher.ts` — hybrid `fs.watch` + polling.
- `src/gitDecorations.ts` / `src/projectDecorations.ts` — file
  decoration providers.
- `src/gitBranch.ts` — direct `.git/HEAD` fallback for repos the
  built-in git extension hasn't adopted.
- `src/download.ts` — HTTP tunnel + `openExternal` download flow.
- `src/diskUsage.ts` — cached `du -sb` per bookmark.
- `src/search.ts` — recursive fuzzy search.
- `src/logger.ts` — diagnostics output channel (`Roam: Show Log`).

---

## Releasing

Releases are automated by the [`release.yml`](.github/workflows/release.yml)
GitHub Actions workflow, which triggers on any `v*` tag push.

To cut a new release:

1. Bump `version` in `package.json`.
2. Add a `## [X.Y.Z] — YYYY-MM-DD` section to `CHANGELOG.md`.
3. Commit and push to `main`.
4. Tag and push:
   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The workflow will:

- Verify the tag matches `package.json`.
- Typecheck and package the extension.
- Publish to Open VSX (using the `OPEN_VSX_TOKEN` repo secret).
- Create a GitHub Release with `roam.vsix` attached and the matching
  CHANGELOG section as the notes.

To publish manually (fallback):

```sh
npm run compile
npm run package
npx ovsx publish -p <TOKEN> roam.vsix
```

Open VSX tokens are created at <https://open-vsx.org/user-settings/tokens>.

---

## Contributing

Issues and PRs welcome at <https://github.com/overdodactyl/roam/issues>.

---

## License

MIT © [overdodactyl](https://github.com/overdodactyl)
