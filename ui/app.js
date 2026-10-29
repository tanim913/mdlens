"use strict";
const T = window.mdlens;
const { invoke } = T;
// App elements are looked up once, before a document's own ids (headings, raw HTML) can shadow them.
const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map((e) => [e.id, e]));
const $ = (id) => ui[id];
const body = document.body, scroller = $("scroll"), preview = $("preview"), source = $("source");
const editor = $("editor"), gutter = $("gutter");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let cur = null; // { path, dir, name, raw, text (raw with \n endings), crlf }
let folder = null; // the open folder's tree, or null in single-file mode
const treeEl = $("tree");
let previewStale = false; // the source was edited since the preview was drawn
let lines = 0;
let toastTimer;

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function showError(title, text) {
  cur = null;
  body.dataset.state = "empty";
  $("empty-title").textContent = title;
  $("empty-text").textContent = text;
  document.title = "mdlens";
  $("name").textContent = "mdlens";
  $("crumb").textContent = "";
}

// Main sends "<full path>: <reason> (os error N)"; the file name and reason are what a reader needs.
const why = (e) => String(e).replace(/^.*: /, "").replace(/ \(os error \d+\)$/, "");

const dirty = () => !!cur && editor.value !== cur.text;

function edited() {
  const n = editor.value.split("\n").length;
  if (n !== lines) gutter.textContent = Array.from({ length: (lines = n) }, (_, i) => i + 1).join("\n");
  previewStale = true;
  if (dirty()) body.dataset.dirty = ""; else delete body.dataset.dirty;
}

/** True when it is fine to replace the open file: no edits, or the reader agreed to drop them. */
function leave() {
  if (!dirty()) return true;
  if (!confirm(`Discard your unsaved edits to ${cur.name}?`)) return false;
  editor.value = cur.text;
  edited();
  return true;
}

async function save() {
  if (!dirty()) return;
  const text = editor.value;
  try { await invoke("save", { path: cur.path, raw: cur.crlf ? text.replace(/\n/g, "\r\n") : text }); }
  catch (e) { return toast(`Can’t save ${cur.name}: ${why(e)}`); }
  cur.text = text;
  edited();
}

function fixMedia(root, dir) {
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (/^(https?:|data:)/i.test(src)) continue;
    try { img.src = "mdfile://f/" + encodeURIComponent(dir + "/" + decodeURIComponent(src)); } catch { /* malformed escape: leave broken */ }
  }
}

// A big file arrives in slices instead of freezing the window while it lays out.
function fill(el, html, dir, done) {
  const job = el.fillJob = (el.fillJob || 0) + 1, tpl = document.createElement("template");
  // Raw HTML in the file is untrusted: no scripts, handlers or forms, and no styles that could restyle the app.
  tpl.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] });
  if (dir) fixMedia(tpl.content, dir);
  el.replaceChildren();
  const step = () => {
    if (job !== el.fillJob) return; // a newer file replaced this one
    for (let i = 0; i < 40 && tpl.content.firstChild; i++) el.appendChild(tpl.content.firstChild);
    tpl.content.firstChild ? requestAnimationFrame(step) : done();
  };
  step();
}

async function open(path, base) {
  if (!leave()) return;
  let r;
  try { r = await invoke("load", { path, base: base ?? null }); }
  catch (e) {
    const name = String(path).split(/[\\/]/).pop();
    return cur ? toast(`Can’t open ${name}: ${why(e)}`) : showError(`Can’t open ${name}`, why(e));
  }

  const same = cur && cur.path === r.path;
  const top = same ? scroller.scrollTop : 0;
  cur = { ...r, text: r.raw.replace(/\r\n/g, "\n"), crlf: r.raw.includes("\r\n") };
  fill(preview, r.html, r.dir, () => { scroller.scrollTop = top; });
  // Leave the editor alone when the text is unchanged (our own save reloading), so the caret stays put.
  if (editor.value !== cur.text) editor.value = cur.text;
  edited();
  previewStale = false;
  body.dataset.state = "ready";

  const parts = r.dir.split(/[\\/]/).filter(Boolean);
  markActive(r.path);
  $("name").textContent = r.name;
  $("crumb").textContent = "…/" + parts.slice(-2).join("/");
  document.title = r.name + " — mdlens";
  if (r.size > 5_000_000) toast("Large file — rendering may be slow");
}

function setView(view) {
  if (view === body.dataset.view || body.dataset.state === "empty") return;
  const apply = () => {
    body.dataset.view = view;
    const src = view === "source";
    preview.hidden = src; source.hidden = !src;
    $("tab-preview").setAttribute("aria-selected", String(!src));
    $("tab-source").setAttribute("aria-selected", String(src));
    if (!src && previewStale && cur) {
      previewStale = false;
      invoke("render", { raw: editor.value }).then((h) => fill(preview, h, cur.dir, () => {}));
    }
    scroller.scrollTop = 0;
    if (src) editor.focus({ preventScroll: true });
    scroller.classList.remove("swap");
  };
  body.dataset.view = view; // slides the pill immediately
  if (reduced) return apply();
  scroller.classList.add("swap");
  setTimeout(apply, 90);
}

async function pick() {
  const path = await invoke("pick", { directory: false });
  if (path) openAny(path);
}

async function pickFolder() {
  const path = await invoke("pick", { directory: true });
  if (path) openAny(path);
}

// ---- folder panel ----
const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>';

function node(n, depth) {
  const li = document.createElement("li"), label = document.createElement("span");
  li.style.setProperty("--depth", depth);
  label.textContent = n.name;
  if (n.children) {
    const d = document.createElement("details"), s = document.createElement("summary"), ul = document.createElement("ul");
    s.innerHTML = CHEVRON;
    s.append(label);
    s.title = n.name;
    ul.append(...n.children.map((c) => node(c, depth + 1)));
    d.append(s, ul);
    li.append(d);
  } else {
    const b = document.createElement("button");
    b.className = "file";
    b.title = n.name;
    b.dataset.path = n.path;
    b.append(label);
    li.append(b);
  }
  return li;
}

function setFolder(t) {
  folder = t;
  if (!t) { delete body.dataset.folder; treeEl.replaceChildren(); return; }
  body.dataset.folder = "";
  $("side-name").textContent = t.name;
  $("side-name").title = t.path;
  treeEl.replaceChildren(...t.children.map((n) => node(n, 0)));
}

function markActive(path) {
  for (const b of treeEl.querySelectorAll(".file[aria-current]")) b.removeAttribute("aria-current");
  const b = [...treeEl.querySelectorAll(".file")].find((x) => x.dataset.path === path);
  if (!b) return;
  b.setAttribute("aria-current", "page");
  for (let d = b.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
  b.scrollIntoView({ block: "nearest" });
}

function toggleSide(collapse = body.dataset.side !== "collapsed") {
  if (collapse) body.dataset.side = "collapsed"; else delete body.dataset.side;
  $("side-btn").setAttribute("aria-expanded", String(!collapse));
  try { localStorage.setItem("side", collapse ? "collapsed" : ""); } catch { /* storage unavailable: state just won't persist */ }
}
try { if (localStorage.getItem("side") === "collapsed") toggleSide(true); } catch { /* ignore */ }

// Files, drops and the command line can hand over a file or a folder; a single file closes the folder panel.
async function openAny(path) {
  if (!leave()) return;
  let t = null;
  try { t = await invoke("tree", { path }); } catch { /* unreadable: open() reports it */ }
  if (!t) { setFolder(null); return open(path); }
  setFolder(t);
  const top = t.children.filter((n) => !n.children);
  const first = top.find((n) => /^readme\./i.test(n.name)) || top.find((n) => /^index\./i.test(n.name)) || top[0];
  if (first) return open(first.path);
  showError(t.children.length ? "Pick a file" : "No Markdown here",
    t.children.length ? "Choose a file from the folder panel." : `${t.name} has no .md files.`);
  $("name").textContent = t.name;
}

/** Steps a :root number (--zoom: type size, --width: page width in rem); delta 0 resets it. */
function step(name, delta, min, max, reset) {
  const v = delta === 0 ? reset : Math.min(max, Math.max(min, +(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--" + name)) + delta).toFixed(2)));
  document.documentElement.style.setProperty("--" + name, v);
  try { localStorage.setItem(name, v); } catch { /* storage unavailable: it just won't persist */ }
}
for (const name of ["zoom", "width"]) {
  try { const v = localStorage.getItem(name); if (v) document.documentElement.style.setProperty("--" + name, v); } catch { /* ignore */ }
}

// ---- events ----
$("tab-preview").onclick = () => setView("preview");
$("tab-source").onclick = () => setView("source");
$("open-btn").onclick = pick;
$("open-folder-btn").onclick = pickFolder;
$("side-btn").onclick = () => toggleSide();
treeEl.addEventListener("click", (e) => {
  const b = e.target.closest("button.file");
  if (b) open(b.dataset.path);
});
$("w-min").onclick = () => T.win("minimize");
$("w-max").onclick = () => T.win("toggleMaximize");
$("w-close").onclick = () => T.win("close");

addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "/") { setView(body.dataset.view === "source" ? "preview" : "source"); }
  else if (e.key === "o") pick();
  else if (e.key === "O") pickFolder();
  else if (e.key === "s") save();
  else if (e.key === "b" && folder) toggleSide();
  else if (e.key === "=" || e.key === "+") step("zoom", 0.1, 0.6, 2, 1);
  else if (e.key === "-") step("zoom", -0.1, 0.6, 2, 1);
  else if (e.key === "0") step("zoom", 0, 0.6, 2, 1);
  else if (e.key === "]") step("width", 6, 36, 240, 64);
  else if (e.key === "[") step("width", -6, 36, 240, 64);
  else return;
  e.preventDefault();
});

preview.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href.startsWith("#")) {
    const t = preview.querySelector("#" + CSS.escape(decodeURIComponent(href.slice(1))));
    if (t) t.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    invoke("open_external", { url: href });
  } else if (cur && /\.(md|markdown|mdown)([?#].*)?$/i.test(href)) {
    open(decodeURIComponent(href.replace(/[?#].*$/, "")), cur.dir);
  }
});

let reloadTimer;
// A save fires several fs events; reload once after they settle.
// With unsaved edits the editor wins; saving then overwrites the file.
T.listen("file-changed", () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => cur && !dirty() && open(cur.path), 80); });
editor.addEventListener("input", edited);
// Electron reads a set returnValue as "keep the window"; main then asks whether to close anyway.
addEventListener("beforeunload", (e) => { if (dirty()) e.returnValue = false; });
T.listen("open-file", openAny);
// preventDefault on dragover/drop stops the window from navigating to the dropped file.
addEventListener("dragover", (e) => { e.preventDefault(); body.classList.add("dragging"); });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) body.classList.remove("dragging"); });
addEventListener("drop", (e) => {
  e.preventDefault();
  body.classList.remove("dragging");
  const f = e.dataTransfer.files[0];
  if (f) openAny(T.pathForFile(f));
});

invoke("initial_file").then((p) => p && openAny(p));
