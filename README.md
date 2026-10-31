# Simple Markdown

**English** | [简体中文](README.zh-CN.md)

A desktop Markdown reader with a single goal: making Markdown comfortable to read. **The interface is as plain as possible — once a document is open, nothing is left on screen but the document itself.** Files refresh automatically when you save them, and double-clicking a file opens it. No license key, no subscription.

<img width="574" height="370" alt="Simple Markdown screenshot" src="https://github.com/user-attachments/assets/c5f2379b-5f3c-4333-aa3f-769a26c08352" />

https://github.com/user-attachments/assets/95a7948b-99e1-40f8-85c2-63ce94760b24

## What it is

A fully local, offline Markdown reader that does one thing — reading. No editing, no sync, no accounts.

| Feature | Details |
|---|---|
| Auto-refresh | Updates the view about a second after you save, keeping your reading position |
| Tabs | Documents share one window as tabs and can be dragged to reorder; right-click a tab to reveal the file in Finder, or to copy its file path or file name |
| Outline | A left sidebar; click an entry to jump, the current section is highlighted as you scroll, and the width can be dragged |
| Rendering | Syntax highlighting, math formulas, Mermaid diagrams, tables, and task lists |
| Reading width | Drag the body width to adjust it; both margins adjust symmetrically |
| Find | `Cmd+F` highlights every match, shows a count, and cycles through them |
| Export PDF | A4 layout with styles preserved |
| Light/dark themes | Two palettes, each tuned separately |
| Offline | All rendering libraries are bundled locally, so it works without a network |

You can also open a blank page and paste Markdown text into it for a quick read (the content lives only in memory and is never written to disk). Pasting is blocked while a file is open, to avoid accidental overwrites; press ⌘T to create a blank page first.

## Download and install

### macOS (Apple silicon)

Grab `SimpleMarkdown-*-mac-arm64.zip` from [Releases](https://github.com/belveyf/mdview-app/releases), unzip it, and drag `SimpleMarkdown.app` into the Applications folder.

If macOS says it cannot verify the developer on first launch, right-click → Open to allow it once (the app is not notarized by Apple).

### Other platforms: grab the source and let an AI package it

**Windows, Linux, and Intel Macs all work.** The UI is built with web technology, the shell is Electron, and the menu shortcuts are written as `CmdOrCtrl` for cross-platform use, so nothing in the code is tied to macOS.

The repo only ships a ready-made macOS arm64 build. For other platforms, build it yourself — hand the whole project folder to an AI and state the target platform, for example:

> This is an Electron app. Package it for Windows x64 and explain how to install it.

Doing it yourself is not hard either: install the dependencies, then pick the command for your platform.

```bash
npm install

# macOS (Intel)
npx electron-packager . SimpleMarkdown --platform=darwin --arch=x64 --icon=SimpleMarkdown.icns
# Windows
npx electron-packager . SimpleMarkdown --platform=win32 --arch=x64
# Linux
npx electron-packager . SimpleMarkdown --platform=linux --arch=x64
```

The output goes to `dist/`. Three things need platform-specific adjustments, all of which you can hand to an AI:

- **Icon**: Windows wants `.ico` and Linux wants `.png`; the repo only contains the macOS `.icns` and a single `icon.png`
- **File association**: on macOS, `install.sh` registers the app with the system; Windows and Linux need their own installer or desktop entry
- **Window title bar**: the system title bar is hidden and room is left for the window buttons in the top-left corner; other platforms need their own control style

## Open from VSCode (optional)

The repo includes a VSCode extension: right-click a `.md` file in the Explorer and choose **用 Simple Markdown 打开** (Open with Simple Markdown), or press `Cmd+Alt+M` (`Ctrl+Alt+M` on Windows/Linux). The extension finds the installed app automatically and hands the file over; if the app is already running, the file opens in a new tab there.

To install: open the Command Palette in VSCode (`Cmd+Shift+P`), run `Extensions: Install from VSIX`, and select the `.vsix` under `vscode-ext/` (it is also available from Releases).

If the app is not in the default location, set `smd.appPath` in the settings; if you leave it empty, the extension searches the Applications folder automatically.

## Want a feature? Just change it

This project has no build step and very little code: the entire UI lives in `renderer/index.html`, and the desktop capabilities — windows, menus, files — are in `main.js`. Want to add or change something? Go ahead. If you would rather not write it yourself, describe the requirement to an AI and have it package the app too.

To see your changes take effect:

- macOS: run `bash install.sh` in the project folder; it repackages and overwrites the installed app
- Other platforms: repackage using the commands above

## Project layout

```
main.js              # main process: windows, menus, file watching, tab management, PDF export
preload.js           # preload: exposes only the APIs the UI needs
renderer/index.html  # UI, tab bar, typography (single file, no build)
renderer/vendor/     # markdown-it / highlight.js / KaTeX / Mermaid
bin/smd              # command-line entry (smd file.md)
dev/isolated-run.sh  # isolated test instance that leaves the one you are using alone
vscode-ext/          # VSCode extension source
install.sh           # macOS packaging + install script
dist/                # build output (git-ignored)
```

## Keyboard shortcuts

macOS uses `Cmd`; on Windows/Linux, use `Ctrl` instead.

| Action | Shortcut |
|---|---|
| New blank page | `Cmd+T` or the `+` in the top bar |
| Open a file | `Cmd+O` |
| Paste Markdown text | `Cmd+V` on a blank page (disabled in a file view) |
| Close a tab | `Cmd+W` |
| Previous / next tab | `⇧Cmd+[` / `⇧Cmd+]` |
| Find in page | `Cmd+F`; `↩` / `⇧↩` to jump between matches, `Esc` to close |
| Export PDF | `⇧Cmd+E` |
| Collapse / expand outline | `Cmd+\` |
| Toggle light/dark theme | `⇧Cmd+L` |
| Adjust body / outline width | Drag the edge of the body or outline |
| Reorder tabs | Drag a tab |

## Known limitations

- The only prebuilt package is macOS arm64; other platforms need to build their own (see above)
- Not notarized by Apple, so the first launch on a new machine requires right-click → Open
- The app is about 240 MB, mostly the Chromium that Electron bundles
- Read-only: files cannot be edited

## Design and technical trade-offs

- **The UI is invisible until you need it**: scrollbars, the body-width handle, and tab close buttons appear on demand; the palette is black, white, and gray with a single blue accent
- **One window, many tabs**; no multi-window support, and it does not take over as the system default handler — it registers as an alternate handler
- **No session restore**: every launch starts empty; you choose a document yourself
- **No frontend framework, no build step**: every rendering library ships with the app, which is what makes offline use possible; file syncing is a once-per-second modification-time check in the main process
- For more implementation details, read the code — the key decisions are documented in comments
