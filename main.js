"use strict";
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { render, walk } = require("./core");

let win = null;
/** The currently watched file and its watcher; replaced when another file is opened. */
let watch = null;
/** The open file: the only path `save` may write. */
let current = null;
/** Folders of opened files: relative images are served from these only. */
const allowed = new Set();

/** The file or folder named on a command line; file managers may hand over a file:// URI. */
function fileArg(argv, cwd) {
  // Chromium may insert its own switches anywhere; unpackaged, the first plain argument is the app folder.
  const a = argv.slice(1).filter((x) => !x.startsWith("-"))[app.isPackaged ? 0 : 1];
  if (!a) return null;
  return a.startsWith("file://") ? fileURLToPath(a) : path.resolve(cwd, a);
}

/** "<full path>: <reason>", the shape the window trims down for display. */
const fail = (p, e) => new Error(`${p}: ${String(e.message).replace(/^\w+: /, "").replace(/, \w+ '.*'$/s, "")}`);

function load({ path: file, base }) {
  let p = base && !path.isAbsolute(file) ? path.join(base, file) : file;
  try { p = fs.realpathSync(p); } catch (e) { throw fail(p, e); }
  let bytes;
  try { bytes = fs.readFileSync(p); } catch (e) { throw fail(p, e); }
  const dir = path.dirname(p);
  allowed.add(dir);
  current = p;

  if (watch?.path !== p) {
    watch?.watcher.close();
    watch = null;
    const name = path.basename(p);
    // Watch the folder: editors that save via rename replace the file's inode.
    try {
      const w = fs.watch(dir, (_ev, f) => f === name && win?.webContents.send("file-changed"));
      w.on("error", () => {});
      watch = { path: p, watcher: w };
    } catch {
      // OS watch limit reached (ENOSPC/EMFILE): the file still opens, only live reload is off.
    }
  }

  const raw = bytes.toString("utf8");
  return { path: p, dir, name: path.basename(p), html: render(raw), raw, size: bytes.length };
}

/** The folder's Markdown tree, or null when `path` is a file. */
function tree({ path: dir }) {
  const p = fs.realpathSync(dir);
  if (!fs.statSync(p).isDirectory()) return null;
  return { name: path.basename(p) || p, path: p, children: walk(p, { n: 20_000 }) };
}

function serveImage(req) {
  let p;
  try { p = fs.realpathSync(decodeURIComponent(new URL(req.url).pathname.slice(1))); } catch { return new Response(null, { status: 404 }); }
  if (![...allowed].some((d) => p.startsWith(d + path.sep))) return new Response(null, { status: 403 });
  return net.fetch(pathToFileURL(p).toString());
}

protocol.registerSchemesAsPrivileged([{ scheme: "mdfile", privileges: { standard: true, secure: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv, cwd) => {
    const p = fileArg(argv, cwd);
    if (p) win?.webContents.send("open-file", p);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // No menu: its default accelerators (reload, zoom) would fight the app's own shortcuts.
  Menu.setApplicationMenu(null);

  app.whenReady().then(() => {
    protocol.handle("mdfile", serveImage);
    const initial = fileArg(process.argv, process.cwd());
    ipcMain.handle("load", (_e, a) => load(a));
    ipcMain.handle("tree", (_e, a) => tree(a));
    ipcMain.handle("render", (_e, { raw }) => render(raw));
    ipcMain.handle("save", (_e, { path: p, raw }) => {
      if (p !== current) throw new Error(`${p}: not the open file`);
      try { fs.writeFileSync(p, raw); } catch (e) { throw fail(p, e); }
    });
    ipcMain.handle("initial_file", () => initial);
    ipcMain.handle("pick", async (_e, { directory }) => {
      const r = await dialog.showOpenDialog(win, directory
        ? { properties: ["openDirectory"] }
        : { properties: ["openFile"], filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle("open_external", (_e, { url }) => /^(https?:\/\/|mailto:)/i.test(url) && shell.openExternal(url));
    ipcMain.on("win", (_e, action) => {
      if (action === "minimize") win.minimize();
      else if (action === "toggleMaximize") win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === "close") win.close();
    });

    win = new BrowserWindow({
      title: "mdlens", width: 960, height: 740, minWidth: 480, minHeight: 360,
      frame: false, show: false, backgroundColor: "#0d1013",
      icon: path.join(__dirname, "icons/128x128@2x.png"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
    });
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.once("ready-to-show", () => win.show());
    // The window blocks closing while the source has unsaved edits; ask before dropping them.
    win.webContents.on("will-prevent-unload", (e) => {
      const r = dialog.showMessageBoxSync(win, {
        type: "question", buttons: ["Close without saving", "Cancel"], defaultId: 1, cancelId: 1,
        message: "Close without saving?", detail: "Your edits to the source have not been saved.",
      });
      if (r === 0) e.preventDefault();
    });
    win.loadFile(path.join(__dirname, "ui/index.html"));
  });

  app.on("window-all-closed", () => app.quit());
}
