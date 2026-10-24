# Wave VM

**Ride your own systems.**

Wave VM is a free, open-source desktop application for creating and managing virtual machines locally. It is built with Tauri 2, Rust, and vanilla HTML/CSS/JavaScript, with direct QEMU integration planned.

## Current status

This is **Milestone 1A: Desktop Foundation**. It provides a real application shell, live host diagnostics, QEMU discovery, and versioned local configuration.

Wave VM **cannot create or run virtual machines yet**. VM definitions, disks, QMP control, and the graphical console are intentionally not part of this milestone. The interface labels future functionality rather than pretending it exists.

## What works

- Tauri 2 desktop shell with a vanilla frontend.
- Host diagnostics from Rust: operating system, architecture, logical CPU count, memory, and free space on the application data filesystem.
- QEMU and `qemu-img` discovery through bundled resources, `PATH`, and standard platform locations, including version probing.
- KVM probing on Linux by opening `/dev/kvm` and issuing `KVM_GET_API_VERSION`. The presence of the device alone is not treated as proof of usability.
- Versioned `config.json` stored in the platform application data directory, written atomically with restrictive permissions on Unix.
- A reserved `vms/` directory for future VM definitions.

## Requirements

- Rust stable and Cargo.
- Node.js 20+ and npm for the Tauri CLI.
- Tauri 2 Linux prerequisites, including WebKitGTK 4.1, GTK 3, and libsoup 3. On Arch Linux the relevant packages are `webkit2gtk-4.1`, `gtk3`, and `libsoup3`.
- Optional: QEMU for meaningful QEMU diagnostics.
- Optional: an accessible `/dev/kvm` device for KVM diagnostics.

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
config.json   # versioned application configuration
vms/          # reserved for future VM definitions and disks
```

Configuration writes use a temporary file in the same directory followed by an atomic rename. The `vms/` directory is created separately and is never removed by this build.

## Architecture

```text
src/                     Vanilla HTML, CSS, and ES modules
src-tauri/src/
  commands/              Narrow Tauri command handlers
  config/                Versioned configuration and atomic persistence
  host/                  Host diagnostics, memory/storage, KVM probe
  qemu/                  Executable discovery, safe version probing
  error.rs               Shared serialized application errors
  state.rs               Application state initialization
```

The Rust backend owns host detection and persistence. The frontend only renders the structured results and handles interaction. Because the frontend is static and has no bundler, it calls the two registered commands through Tauri's global `window.__TAURI__.core.invoke` bridge; the capability is scoped to the main window.

## Known limitations

- No VM creation, disk creation, ISO handling, QMP, networking, or graphical console.
- Only QEMU system emulator discovery for the host architecture and `qemu-img` are implemented; argument construction and process supervision are not.
- Linux KVM probing is implemented. Windows WHPX and macOS HVF detection are not implemented or verified.
- Windows and macOS host behavior has not been verified in this environment.
- QEMU is optional for this milestone; when it is not installed, the UI reports it as missing rather than assuming it is available.
- No installer or packaged release has been produced.

## License

Wave VM is intended to be free and open-source. A license has not yet been selected or added to this repository.
