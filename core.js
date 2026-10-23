"use strict";
const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");

// html: false keeps raw HTML in the source escaped: .md files are untrusted input.
const md = new MarkdownIt({ html: false, linkify: true })
  .use(require("markdown-it-footnote"))
  .use(require("markdown-it-task-lists"));
// Fuzzy linking would turn "README.md" (.md is a TLD) into a web link.
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
md.renderer.rules.footnote_caption = (tokens, idx) => String(tokens[idx].meta.id + 1);
md.renderer.rules.s_open = () => "<del>";
md.renderer.rules.s_close = () => "</del>";
md.renderer.rules.footnote_block_open = () => '<section class="footnotes">\n<ol class="footnotes-list">\n';

// Same ids GitHub and comrak give: lowercase, punctuation dropped, spaces to dashes, repeats numbered.
md.core.ruler.push("heading_ids", (state) => {
  const seen = new Map();
  state.tokens.forEach((t, i) => {
    if (t.type !== "heading_open") return;
    const base = state.tokens[i + 1].children.filter((c) => c.type === "text" || c.type === "code_inline")
      .map((c) => c.content).join("").toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    t.attrSet("id", n ? `${base}-${n}` : base);
  });
});

/** Markdown to HTML, with a leading `---` front matter block left out. */
function render(src) {
  return md.render(src.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, ""));
}

const SKIP = ["node_modules", "target", "vendor"];
const isMd = (p) => /\.(md|markdown|mdown)$/i.test(p);

/** Markdown files under `dir`, folders first; folders with no Markdown anywhere inside are dropped. */
// shortcut: walks the whole tree up front, capped at `budget.n` entries; switch to per-folder listing if big folders feel slow.
function walk(dir, budget) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (budget.n === 0) break;
    budget.n--;
    if (e.name.startsWith(".") || SKIP.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    // Dirent doesn't follow symlinks, so a linked folder can't send the walk in a loop.
    if (e.isDirectory()) {
      const children = walk(p, budget);
      if (children.length) out.push({ name: e.name, path: p, children });
    } else if (isMd(p)) {
      out.push({ name: e.name, path: p, children: null });
    }
  }
  const key = (n) => (n.children ? "0" : "1") + n.name.toLowerCase();
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

module.exports = { render, walk };
