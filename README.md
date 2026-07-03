# File Browser (dilops-file-browser)

A native VS Code / Positron sidebar extension for navigating arbitrary directories
outside the current workspace. Bookmark any folder on disk (`~/`,
`/shares/nfs/dil/development/`, wherever), then browse it as a tree in a dedicated
sidebar panel. Uses the native `TreeView` widget, so it inherits your file icon
theme and looks the same as the built-in Explorer.

## Install

```sh
module load node/20
npm install
npm run compile
npm run package    # produces dilops-file-browser.vsix
```

Then in Positron: `Ctrl+Shift+P` → `Extensions: Install from VSIX…` → pick the
generated `.vsix`. Reload the window.

## Usage

- Click the folder-library icon in the Activity Bar to open the File Browser view.
- **Add Bookmark** button in the view title bar → pick a folder via the OS folder picker.
- **Add Bookmark by Path…** (Command Palette) → type any absolute path.
- Click a folder to expand; click a file to open it in the editor.
- Right-click a bookmark → Rename / Remove. Right-click a subfolder → Bookmark
  This Folder (promotes it to a top-level bookmark).
- Right-click anything → Copy Path / Open in Integrated Terminal / Reveal in
  OS File Manager.

## Settings

- `dilopsFileBrowser.showHiddenFiles` — default `false`.
- `dilopsFileBrowser.foldersFirst` — default `true`.

## Development

```sh
module load node/20
npm install
npm run watch   # incremental compile
```

Then `F5` in VS Code / Positron with this folder open launches an Extension
Development Host with the extension loaded.
