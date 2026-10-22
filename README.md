# mdlens

**Markdown, already rendered.** mdlens is a small dark-glass viewer for `.md` files on Ubuntu. Double-click a file and you are reading it, not its syntax. The source is one key away.

[Website](https://tanim913.github.io/mdlens/) · [Download](https://github.com/tanim913/mdlens/releases/latest)

![mdlens showing a folder of notes: a glass sidebar lists the Markdown files and the open README is rendered with headings, a checklist, a table and a code block.](docs/img/folder.webp)

## Features

- **Opens rendered.** Tables, task lists, footnotes, code blocks, heading anchors and local images (GitHub-flavoured Markdown).
- **Source on `Ctrl` + `/`.** A read-only source view with line numbers.
- **Live reload.** Save the file in any editor and the page updates in place, keeping your scroll position.
- **Folders.** Open a folder to get a collapsible panel of its Markdown files, starting at the README. A single file opens without the panel.
- **Safe with untrusted files.** Raw HTML in Markdown stays escaped. Web links open in your browser; relative `.md` links open in mdlens.
- **Light.** A 5 MB Rust binary on the system web view, one window for every file you open, and no network access except for remote images in the file itself.

## Install

Ubuntu 20.04 or 22.04 (the app needs `libwebkit2gtk-4.0`):

```sh
wget https://github.com/tanim913/mdlens/releases/latest/download/mdlens_0.1.0_amd64.deb
sudo apt install ./mdlens_0.1.0_amd64.deb
xdg-mime default mdlens.desktop text/markdown   # open .md files with mdlens by default
```

mdlens then also appears in the file manager's **Open With** menu for Markdown files and for folders.

## Usage

```sh
mdlens notes.md      # open a file
mdlens ~/docs        # open a folder with the file panel
```

| Keys | Action |
|---|---|
| `Ctrl` `/` | Preview or Source |
| `Ctrl` `O` | Open a file |
| `Ctrl` `Shift` `O` | Open a folder |
| `Ctrl` `B` | Show or hide the folder panel |
| `Ctrl` `+` / `-` / `0` | Zoom |

You can also drop a file or a folder onto the window.

## Build from source

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install build-essential pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.0-dev librsvg2-dev
cargo install tauri-cli --version "^1" --locked

cargo test           # render and folder-tree tests
./build-deb.sh       # builds target/release/bundle/deb/mdlens_0.1.0_amd64.deb
```

`build-deb.sh` runs `cargo tauri build` and then repacks the `.deb`, because tauri-bundler 1.x writes an invalid archive when your user ID is longer than six digits.

The app is Tauri 1 with plain HTML, CSS and JavaScript in `ui/`; the Markdown is rendered in Rust with [comrak](https://github.com/kivikakk/comrak) (`src/render.rs`).

## Limits

- Tested on Ubuntu 20.04 only. Newer Ubuntu releases ship only WebKitGTK 4.1, which this Tauri 1 build does not use yet.
- No Windows or macOS release yet.
- Viewer only: no editing, tabs, search or table of contents.
- The folder panel is read when the folder opens; files added later appear after reopening it.

## License

MIT, see [LICENSE](LICENSE). The bundled fonts, [Literata](https://github.com/googlefonts/literata) and [Commit Mono](https://github.com/eigilnikolajsen/commit-mono), are under the SIL Open Font License; their licences are in `ui/fonts/`.
