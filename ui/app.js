"use strict";
const T = window.mdlens;
const { invoke } = T;
const $ = (id) => document.getElementById(id);
const body = document.body, scroller = $("scroll"), preview = $("preview"), source = $("source");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let cur = null; // { path, dir, raw }
let folder = null; // the open folder's tree, or null in single-file mode
const treeEl = $("tree");
let sourceStale = true;
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

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function renderSource(raw) {
  let fence = false;
  fill(source, raw.split("\n").map((line) => {
    let cls = "";
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; cls = " f"; }
    else if (fence) cls = " c";
    else if (/^#{1,6}\s/.test(line)) cls = " h";
    else if (line.startsWith(">")) cls = " q";
    return `<span class="l${cls}">${esc(line) || " "}</span>`;
  }).join(""), null, () => {});
  sourceStale = false;
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
  tpl.innerHTML = html;
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
  let r;
  try { r = await invoke("load", { path, base: base ?? null }); }
  catch (e) {
    // Rust sends "<full path>: <reason> (os error N)"; the file name and reason are what a reader needs.
    const why = String(e).replace(/^.*: /, "").replace(/ \(os error \d+\)$/, "");
    const name = String(path).split(/[\\/]/).pop();
    return cur ? toast(`Can’t open ${name}: ${why}`) : showError(`Can’t open ${name}`, why);
  }

  const same = cur && cur.path === r.path;
  const top = same ? scroller.scrollTop : 0;
  cur = r;
  fill(preview, r.html, r.dir, () => { scroller.scrollTop = top; });
  sourceStale = true;
  if (body.dataset.view === "source") renderSource(r.raw);
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
    if (src && sourceStale && cur) renderSource(cur.raw);
    scroller.scrollTop = 0;
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

function zoom(delta) {
  const z = delta === 0 ? 1 : Math.min(2, Math.max(0.6, +(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) + delta).toFixed(2)));
  document.documentElement.style.setProperty("--zoom", z);
  try { localStorage.setItem("zoom", z); } catch { /* storage unavailable: zoom just won't persist */ }
}
try { const z = localStorage.getItem("zoom"); if (z) document.documentElement.style.setProperty("--zoom", z); } catch { /* ignore */ }

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
  else if (e.key === "b" && folder) toggleSide();
  else if (e.key === "=" || e.key === "+") zoom(0.1);
  else if (e.key === "-") zoom(-0.1);
  else if (e.key === "0") zoom(0);
  else return;
  e.preventDefault();
});

preview.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href.startsWith("#")) {
    const t = document.getElementById(decodeURIComponent(href.slice(1)));
    if (t) t.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    invoke("open_external", { url: href });
  } else if (cur && /\.(md|markdown|mdown)([?#].*)?$/i.test(href)) {
    open(decodeURIComponent(href.replace(/[?#].*$/, "")), cur.dir);
  }
});

let reloadTimer;
// A save fires several fs events; reload once after they settle.
T.listen("file-changed", () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => cur && open(cur.path), 80); });
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
