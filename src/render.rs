use comrak::{markdown_to_html, Options};

/// Markdown to HTML. Raw HTML in the source stays escaped: .md files are untrusted input.
pub fn render(md: &str) -> String {
    let mut o = Options::default();
    o.extension.table = true;
    o.extension.strikethrough = true;
    o.extension.tasklist = true;
    o.extension.autolink = true;
    o.extension.footnotes = true;
    o.extension.header_id_prefix = Some(String::new());
    o.extension.front_matter_delimiter = Some("---".into());
    markdown_to_html(md, &o)
}

#[cfg(test)]
mod tests {
    use super::render;

    #[test]
    fn gfm_features() {
        let h = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~\n\n# Hello World\n");
        assert!(h.contains("<table>"));
        assert!(h.contains("type=\"checkbox\""));
        assert!(h.contains("<del>gone</del>"));
        assert!(h.contains("id=\"hello-world\""));
    }

    #[test]
    fn raw_html_stays_escaped() {
        let h = render("<script>alert(1)</script>\n\n[x](javascript:alert(1))");
        assert!(!h.contains("<script"));
        assert!(!h.contains("href=\"javascript:"));
    }

    #[test]
    fn front_matter_is_hidden() {
        assert!(!render("---\ntitle: x\n---\n\nbody").contains("title: x"));
    }
}
