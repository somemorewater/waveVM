# Wave VM brand assets

These files are local copies of the Wave VM brand assets from the sibling
Wave VM website project (repository `waveVM-website`, asset directory
`src/assets`):

- `favicon.svg` — website favicon source.
- `wave-vm-symbol-white.svg` — white wave symbol used on the desktop empty-state panel.
- `wave-vm-symbol-navy.svg` — navy wave symbol used in the desktop footer.
- `wave-vm-wordmark-white.svg` — white wordmark used in the desktop sidebar.

The website's `wave-vm-icon.svg` is copied to
`src-tauri/icons/icon.svg` and used as the source for the generated Tauri
platform icons (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`,
`icon.icns`, and `icon.ico`).

These are original Wave VM project assets, covered by the MIT License in this
repository unless a separate notice states otherwise. No third-party font files
are bundled: the desktop uses the website's Avenir Next / Avenir / Segoe UI
system font stack.

The desktop repository keeps these copies so it can build and run independently
of the website directory. Do not replace them with symlinks or relative paths
that leave this repository.
