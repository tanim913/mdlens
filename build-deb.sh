#!/bin/sh
# Builds the .deb, then repacks it: tauri-bundler 1.x writes the real uid into the ar header,
# and a uid over 6 digits (common for domain/LDAP accounts) makes dpkg reject the file.
set -e
cargo tauri build -b deb
d=target/release/bundle/deb
(cd "$d/mdlens_0.1.0_amd64" && rm -f ../mdlens_0.1.0_amd64.deb && ar rcD ../mdlens_0.1.0_amd64.deb debian-binary control.tar.gz data.tar.gz)
dpkg-deb --info "$d/mdlens_0.1.0_amd64.deb" >/dev/null && echo "ok: $d/mdlens_0.1.0_amd64.deb"
