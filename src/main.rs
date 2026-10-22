#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod render;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// The currently watched file and its watcher; replaced when another file is opened.
struct Watch(Mutex<Option<(PathBuf, RecommendedWatcher)>>);

#[derive(Serialize)]
struct Doc {
    path: String,
    dir: String,
    name: String,
    html: String,
    raw: String,
    size: u64,
}

/// Drop the `\\?\` prefix canonicalize adds on Windows; the asset protocol can't serve it.
fn plain(p: &Path) -> String {
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

#[tauri::command]
fn load(app: AppHandle, watch: State<Watch>, path: String, base: Option<String>) -> Result<Doc, String> {
    let mut p = PathBuf::from(&path);
    if let (Some(b), true) = (base, p.is_relative()) {
        p = Path::new(&b).join(p);
    }
    let p = p.canonicalize().map_err(|e| format!("{}: {e}", p.display()))?;
    let bytes = std::fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    let raw = String::from_utf8_lossy(&bytes).into_owned();
    let dir = p.parent().ok_or("file has no folder")?.to_path_buf();

    // Relative images are served from the file's own folder only.
    app.asset_protocol_scope().allow_directory(&dir, true).map_err(|e| e.to_string())?;

    let mut slot = watch.0.lock().unwrap();
    if slot.as_ref().map(|(w, _)| w) != Some(&p) {
        let (handle, target) = (app.clone(), p.clone());
        // Watch the folder: editors that save via rename replace the file's inode.
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if !ev.kind.is_access() && ev.paths.iter().any(|q| q.file_name() == target.file_name()) {
                    let _ = handle.emit_all("file-changed", ());
                }
            }
        })
        .map_err(|e| e.to_string())?;
        w.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
        *slot = Some((p.clone(), w));
    }

    Ok(Doc {
        path: plain(&p),
        dir: plain(&dir),
        name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        html: render::render(&raw),
        raw,
        size: bytes.len() as u64,
    })
}

#[derive(Serialize)]
struct Node {
    name: String,
    path: String,
    /// `None` for a file; the sorted contents for a folder.
    children: Option<Vec<Node>>,
}

const SKIP: [&str; 3] = ["node_modules", "target", "vendor"];

fn is_md(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("md" | "markdown" | "mdown"))
}

/// Markdown files under `dir`, folders first; folders with no Markdown anywhere inside are dropped.
// shortcut: walks the whole tree up front, capped at `budget` entries; switch to per-folder listing if big folders feel slow.
fn walk(dir: &Path, budget: &mut usize) -> Vec<Node> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        let path = e.path();
        // file_type() doesn't follow symlinks, so a linked folder can't send the walk in a loop.
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let children = walk(&path, budget);
            if !children.is_empty() {
                out.push(Node { name, path: plain(&path), children: Some(children) });
            }
        } else if is_md(&path) {
            out.push(Node { name, path: plain(&path), children: None });
        }
    }
    out.sort_by_cached_key(|n| (n.children.is_none(), n.name.to_lowercase()));
    out
}

/// The folder's Markdown tree, or `None` when `path` is a file.
#[tauri::command]
fn tree(path: String) -> Result<Option<Node>, String> {
    let p = Path::new(&path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    if !p.is_dir() {
        return Ok(None);
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| plain(&p));
    Ok(Some(Node { name, children: Some(walk(&p, &mut 20_000)), path: plain(&p) }))
}

#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().nth(1)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(a) = argv.get(1) {
                let _ = app.emit_all("open-file", Path::new(&cwd).join(a).to_string_lossy());
            }
            if let Some(w) = app.get_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(Watch(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![load, tree, initial_file])
        .run(tauri::generate_context!())
        .expect("failed to run mdlens");
}

#[cfg(test)]
mod tests {
    use super::walk;

    #[test]
    fn walk_keeps_markdown_and_drops_the_rest() {
        let root = std::env::temp_dir().join(format!("mdlens-walk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for d in ["docs/deep", "empty", ".git", "node_modules/x"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in ["README.md", "docs/b.md", "docs/A.markdown", "docs/deep/c.md", "notes.txt", ".git/x.md", "node_modules/x/y.md"] {
            std::fs::write(root.join(f), "").unwrap();
        }
        let t = walk(&root, &mut 100);
        let names = |v: &[super::Node]| v.iter().map(|n| n.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(&t), ["docs", "README.md"]);
        assert_eq!(names(t[0].children.as_ref().unwrap()), ["deep", "A.markdown", "b.md"]);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
