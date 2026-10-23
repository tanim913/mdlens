"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { render, walk } = require("../core");

test("gfm features", () => {
  const h = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~\n\n# Hello World\n\n# Hello World\n\nnote[^1]\n\n[^1]: text\n");
  assert.match(h, /<table>/);
  assert.match(h, /type="checkbox"/);
  assert.match(h, /<del>gone<\/del>/);
  assert.match(h, /id="hello-world"/);
  assert.match(h, /id="hello-world-1"/);
  assert.match(h, /<section class="footnotes">/);
  assert.match(h, /<a href="#fn1" id="fnref1">1<\/a>/);
});

test("raw html stays escaped", () => {
  const h = render("<script>alert(1)</script>\n\n[x](javascript:alert(1))");
  assert.ok(!h.includes("<script"));
  assert.ok(!h.includes('href="javascript:'));
});

test("front matter is hidden, file names are not links", () => {
  const h = render("---\ntitle: x\n---\n\nsee README.md and https://example.com");
  assert.ok(!h.includes("title: x"));
  assert.ok(!h.includes('href="http://README.md"'));
  assert.match(h, /href="https:\/\/example.com"/);
});

test("walk keeps markdown and drops the rest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdlens-walk-"));
  for (const d of ["docs/deep", "empty", ".git", "node_modules/x"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of ["README.md", "docs/b.md", "docs/A.markdown", "docs/deep/c.md", "notes.txt", ".git/x.md", "node_modules/x/y.md"]) {
    fs.writeFileSync(path.join(root, f), "");
  }
  const t = walk(root, { n: 100 });
  const names = (v) => v.map((n) => n.name);
  assert.deepStrictEqual(names(t), ["docs", "README.md"]);
  assert.deepStrictEqual(names(t[0].children), ["deep", "A.markdown", "b.md"]);
  fs.rmSync(root, { recursive: true });
});
