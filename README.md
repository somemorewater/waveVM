# Wave VM

**Ride your own systems.**

Wave VM is a free, open-source desktop application for creating and managing virtual machines locally. It is built with Tauri 2, Rust, and vanilla HTML/CSS/JavaScript, with direct QEMU integration.

## Current status

This is **Milestone 4: Local ISO Installation Support**. It builds on the real VM lifecycle with local ISO selection, persistent installation media, read-only CD/DVD attachment for installer boot, and an explicit switch back to disk boot after installation.

Wave VM can boot a user-supplied local ISO and display the real installer through the existing console. It does not download images, provide an online OS catalogue, or detect installation completion. Image downloads, networking, USB passthrough, and snapshots remain outside this milestone. A running machine can be opened in the console view, which displays the actual guest framebuffer over loopback-only QEMU VNC.

## What works

- Tauri 2 desktop shell with a vanilla frontend.
- A persistent multi-page workspace with Dashboard, Virtual machines, Storage, Installation media, and Settings pages, hash-based navigation, and shared host and machine state.
- Host diagnostics from Rust: operating system, architecture, logical CPU count, memory, and free space on the application data filesystem.
- QEMU and `qemu-img` discovery through bundled resources, `PATH`, and standard platform locations, including version probing.
- KVM probing on Linux by opening `/dev/kvm` and issuing `KVM_GET_API_VERSION`. The presence of the device alone is not treated as proof of usability.
- Creating VM definitions with validated names, memory, virtual CPU counts, guest architecture, and disk size.
- Creating a thin-provisioned QCOW2 disk with `qemu-img`. Existing disks are never overwritten.
- Starting a real QEMU process with the configured resources, KVM when verified usable, and a TCG fallback.
- QMP lifecycle control over a private Unix socket. The guest console uses QEMU VNC bound to `127.0.0.1` with a per-run password; no public QMP endpoint or guest network device is exposed.
- An interactive guest console using QEMU's WebSocket VNC transport and bundled noVNC 1.7.0. The WebSocket port is discovered through QMP, and the console password is generated per run and kept in memory only.
- An immersive console mode that uses the native Tauri window, hides the application shell, and rescales the guest display through noVNC. F11 or the on-screen fullscreen control toggles fullscreen. Mouse capture uses the webview Pointer Lock API after an explicit control is activated; Esc releases capture and returns keyboard focus to the host.
- Stopping a VM with `system_powerdown`, a QMP `quit` fallback, and bounded process termination fallbacks.
- Tracking the child process, preventing duplicate launches, detecting unexpected exits through polling, and reconciling persisted state.
- Selecting an existing local ISO through the native Tauri file dialog, with Rust-side validation of the absolute path, regular-file type, `.iso` extension, and readability. The ISO is never copied, modified, or deleted.
- Attaching, replacing, or detaching installation media only while a machine is stopped. Installer boot attaches the ISO as a read-only CD/DVD and boots it first; disk boot starts the QCOW2 disk without the installer.
- Versioned `config.json` stored in the platform application data directory, written atomically with restrictive permissions on Unix. Schema version 3 stores VM definitions, optional installation media, and the boot mode; version 2 configurations migrate automatically.
- A `vms/` directory containing each machine's disk and QEMU log.

## Brand assets

The desktop interface uses the existing Wave VM brand assets from the website
project: the white wordmark, white and navy symbols, favicon, and the app-icon
source. Copies live in `src/assets/brand/` and `src-tauri/icons/`; see
`src/assets/brand/README.md` for provenance. The desktop app does not read from
or depend on the website repository at build time or runtime.

## Requirements

- Rust stable and Cargo.
- Node.js 20+ and npm for the Tauri CLI.
- Tauri 2 Linux prerequisites, including WebKitGTK 4.1, GTK 3, and libsoup 3. On Arch Linux the relevant packages are `webkit2gtk-4.1`, `gtk3`, and `libsoup3`.
- QEMU and `qemu-img` for VM disk creation and process lifecycle operations. The console requires a QEMU build with WebSocket VNC support; this environment was verified with QEMU 11.1.2.
- Optional: an accessible `/dev/kvm` device for KVM acceleration. Without it, QEMU uses software emulation (TCG).

Wave VM never requires root. It does not install drivers, change group membership, or modify host configuration.

## Development

```sh
npm install
npm run dev
```

The frontend is static and has no bundler. Tauri serves the files in `src/`.

## Checks

```sh
npm run check:frontend
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
```

The Rust check requires the Tauri system libraries to be installed. QEMU is not required to compile or launch the shell.

## Local data

Tauri resolves the application data directory from the bundle identifier `com.wavevm.desktop`. Typical locations are:

- Linux: `$XDG_DATA_HOME/com.wavevm.desktop` or `~/.local/share/com.wavevm.desktop`
- macOS: `~/Library/Application Support/com.wavevm.desktop`
- Windows: `%APPDATA%\com.wavevm.desktop`

The application creates:

```text
config.json             # versioned application configuration (schema v3)
vms/<machine-id>/       # one directory per machine
  disk.qcow2            # QCOW2 virtual disk
  qemu.log              # latest QEMU run log
```

Configuration writes use a temporary file in the same directory followed by an atomic rename. The `vms/` directory and VM disks are never removed automatically by this build.

## Architecture

```text
src/
  app.js                 Application bootstrap, router wiring, page lifecycle
  router.js              Hash routes and navigation
  state/                 Shared host, application, and machine state
  services/              Tauri command wrappers and local preferences
  components/            Persistent shell and reusable UI
  pages/                 Dashboard, machines, storage, media, settings
  styles/                Tokens, global/layout/components, page styles
  assets/brand/          Local Wave VM brand SVGs
  vendor/novnc/          Bundled noVNC 1.7.0 client and licenses
src-tauri/src/
  commands/              Narrow Tauri command handlers
  config/                Versioned configuration, schema migration, atomic persistence
  host/                  Host diagnostics, memory/storage, KVM probe
  qemu/                  Executable discovery, safe version probing
  qmp/                   Minimal QMP client over a local Unix socket
  vm/                    VM models, validation, disk creation, process lifecycle
  error.rs               Shared serialized application errors
  state.rs               Application state, tracked QEMU processes, exit cleanup
```

The shell and sidebar remain mounted while page modules render into the main outlet. Routes use local hash paths such as `#/dashboard`, `#/machines`, `#/machines/:id`, `#/machines/:id/console`, `#/storage`, `#/media`, and `#/settings`, so browser-style back and forward navigation works without a server.

The Rust backend owns host detection, VM validation, persistence, disk creation, and process lifecycle. The frontend only renders the structured results and handles interaction. Because the frontend is static and has no bundler, it calls the registered commands through Tauri's global `window.__TAURI__.core.invoke` bridge; the capability is scoped to the main window.

## Known limitations

- VM lifecycle operations are currently supported on Linux x86_64 only. Other hosts are reported as unsupported before files or processes are created.
- QEMU and `qemu-img` must be installed for VM operations. The shell still starts and reports their status when they are missing.
- Installation media must be a local `.iso` file. Wave VM does not download images, verify checksums, manage a media catalogue, or detect when a guest installation has completed; switching from installer boot to disk boot is a deliberate user action.
- ISO paths containing commas, newlines, or carriage returns are rejected because they cannot be passed safely through QEMU's option parser.
- The virtual disk is attached with virtio-blk. An installer without a virtio storage driver, including some Windows installers, may not see the disk unless those drivers are supplied by the guest image or an additional driver medium. This milestone does not provide driver media.
- QEMU runs with `-no-reboot`, so a guest-requested restart exits the process instead of rebooting automatically. Start the machine again after changing boot mode.
- Image downloads, networking, USB passthrough, and snapshots are not implemented.
- The console depends on QEMU WebSocket VNC support and is available only while the machine is running. It is bound to loopback and protected by a per-run password. Fullscreen and pointer lock depend on the desktop webview. While pointer lock is active, the browser reserves Escape and routes pointer clicks to the guest, so Esc is the reliable release path; the visible mouse control shows the captured state and becomes clickable once capture ends. After release, click the guest to resume input and Escape will reach the guest again. Ctrl+Alt is not used because it is a guest keyboard combination. Pointer accuracy depends on the guest's configured pointing device.
- KVM acceleration is used only when the probe verifies `/dev/kvm`; otherwise QEMU uses software emulation (TCG) and may be slow.
- There is no UI for editing or deleting machines. Existing disks and VM directories are preserved.
- Normal application exit stops tracked QEMU processes. If the desktop process is force-killed, cleanup guarantees do not apply to an already running child process.
- Windows and macOS host behavior has not been verified in this environment.
- No installer or packaged release has been produced.

## License

Wave VM is released under the MIT License. See [`LICENSE`](LICENSE) for the full text.

Copyright (c) 2026 Water.

Third-party dependencies and any separately licensed assets retain their original
licenses. The MIT License does not override those terms. The bundled noVNC client
is licensed under the Mozilla Public License 2.0; see
[`src/vendor/novnc/LICENSE.txt`](src/vendor/novnc/LICENSE.txt).
