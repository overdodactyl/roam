# Changelog

All notable changes to Roam are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-07-03

No user-facing changes — infrastructure and testing scaffold for the
next release cycle.

### Added
- GitHub Actions CI workflow (typecheck, test, and package on every
  push to `main` and every PR).
- Release automation: pushing a `v*` tag builds, publishes to Open VSX,
  and cuts a GitHub Release with the `.vsix` attached and the matching
  CHANGELOG section as notes.
- vitest test suite — 47 tests covering the formatting, parsing,
  sorting, and `.git/HEAD` parsing logic.
- Badges (CI status, Open VSX version, Open VSX downloads) on the README.

### Changed
- Pure helper functions consolidated into a single `src/utils.ts`
  module. No behavior change; the previous per-file copies have been
  removed.
- README rewritten to lead with the Open VSX listing and document the
  tag-driven release flow.

## [0.6.0] — 2026-07-03

Initial public release.

Roam grew out of frustration with Positron / VS Code's workspace-only
Explorer when working across paths outside the currently-opened folder.
The 0.6.0 release consolidates everything from the private development
history into one shipping tag.

### Added

**Bookmarks & organization**
- Pin any directory as a top-level bookmark; expand it as a native
  `TreeView` under a dedicated Activity Bar view.
- Group bookmarks into named folders. Rename / delete groups (with a
  keep-bookmarks-or-not prompt when the group has contents).
- Move bookmarks and groups with drag-and-drop or explicit Move Up /
  Move Down commands.
- First-run seed: `$HOME` is auto-added as a Home bookmark.

**File operations**
- New File, New Folder, Rename, Duplicate, Delete (moves to trash;
  falls back to permanent delete with a second confirm when the
  filesystem provider doesn't support trash — e.g. Remote SSH).
- Cross-directory Copy / Cut / Paste with `(1)`, `(2)`, … suffixing on
  name collision.
- Multi-select bulk delete / duplicate / copy path / remove bookmark.

**Navigation**
- Fuzzy-search files under any bookmark or folder via a live QuickPick.
- Go To Path command: type any absolute path or `~/…`, tree expands
  and reveals it. Offers to bookmark the container if the path isn't
  under an existing bookmark.
- Reveal Active Editor File in the tree.
- Recent files section: last 20 files opened through Roam, pinned at
  the top of the tree.

**Signals in the tree**
- Git decorations (M / A / D / U badges with theme-matching colors)
  driven by the built-in `vscode.git` API.
- Git branch shown on bookmarks that point at a repo root — reads the
  built-in git extension when available and falls back to `.git/HEAD`
  directly for repos it hasn't adopted.
- Project-type badges: folders with `renv.lock` / `pyproject.toml` /
  `_targets.R` / `.git` get an R / P / T / G badge in a distinct color.
- Slurm output detector: files matching `slurm-*.out` and `slurm-*.err`
  get an orange **S** badge.
- Modified time in the description slot with a compact or verbose
  format (`2h` vs `2h ago`) — toggled via a title-bar button.
- File size in the description slot — toggled via a title-bar button.
- Sort by name / modified / size, ascending or descending, via a
  title-bar Sort By… button.

**Live refresh**
- Every bookmark path is watched unconditionally; subfolders picked up
  on expand.
- `fs.watch` handles instant refresh where available; a per-directory
  poll (default 3 s) provides the reliable path for NFS mounts where
  inotify events don't cross the mount.

**Remote SSH file transfer**
- Drag files from Finder / File Explorer onto a bookmark or folder to
  upload them to the remote host.
- Right-click a file → Download to My Computer… serves the bytes over
  an ephemeral localhost HTTP server, tunneled to the client via
  `vscode.env.asExternalUri`, and downloaded via `openExternal`.
- Files > 512 MB and folders fall back to a copyable `scp` command
  derived from the current SSH host.

**Workspace integration**
- Open Folder (replace workspace), Open Folder in New Window, and Add
  Folder to Workspace on any bookmark or folder.
- Run This File: right-click a `.R` / `.py` / `.sh` / `.qmd` / `.Rmd`
  runs it in a new terminal with per-extension templates from
  `roam.runners` config.

**Other**
- File-type filter: title-bar button opens a QuickPick with common
  presets (R, Python, shell, markdown, data) or a custom extension
  list. Only affects file entries; folders remain navigable.
- Show / hide hidden files, show / hide modified dates, show / hide
  file sizes — all toggled via title-bar buttons.
- Respects workspace `files.exclude` globs (matched relative to the
  containing bookmark root).
- Auto-hides `.snapshot/` directories (NetApp snapshot dirs, common on
  research shares).
- Opt-in per-bookmark disk-usage display (via `du -sb`, cached with
  a 5 min TTL).
- `Roam: Show Log` command opens an output channel with watcher /
  refresh / download diagnostics.

[0.6.1]: https://github.com/overdodactyl/roam/releases/tag/v0.6.1
[0.6.0]: https://github.com/overdodactyl/roam/releases/tag/v0.6.0
