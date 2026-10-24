# AGENTS.md — Wave VM

## Project Identity

Wave VM is a free, open-source desktop application for creating and managing virtual machines.

**Tagline:** Ride your own systems.

The goal is to make virtualization approachable for beginners while remaining useful to experienced developers.

Core principles:
- Virtual machines run locally on the user's hardware.
- No mandatory account, subscription, cloud service, or remote server.
- Never bundle complete guest operating system images in the installer.
- Prioritize real functionality, reliability, security, and simplicity over superficial UI completeness.

## Technology Stack

- **Desktop:** Tauri 2
- **Backend:** Rust
- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **Initial virtualization engine:** QEMU
- **Linux acceleration:** KVM when available and usable
- **VM runtime control:** QEMU Machine Protocol (QMP)
- **Persistence:** Versioned local JSON configuration initially
- **Initial graphical console:** QEMU VNC with noVNC, subject to a working integration prototype

Do not introduce Electron, React, Next.js, or Tailwind CSS.

Do not make libvirt a mandatory dependency. Prefer direct QEMU integration unless a documented technical limitation justifies a change.

Use additional dependencies only when they provide clear value.

## Architecture Rules

- Keep the Rust backend authoritative for VM configuration, host detection, process management, filesystem operations, and virtualization state.
- Keep the frontend responsible for presentation and user interaction.
- Expose backend functionality through narrowly scoped Tauri commands and events.
- Use typed Rust structures and explicit error handling.
- Separate host-platform capabilities from guest operating-system profiles.
- Isolate platform-specific implementations behind clear interfaces.
- Keep modules focused and maintainable. Avoid unnecessary abstractions.
- Preserve existing code and established architecture unless a concrete problem justifies changing them.
- Never replace functional code with mock implementations merely to complete a UI.

Suggested module boundaries include:
- `host`: host OS, architecture, hardware capabilities, and acceleration detection.
- `qemu`: executable discovery, version checks, argument construction, and process supervision.
- `qmp`: QMP connections, commands, events, and runtime status.
- `vm`: VM definitions, configuration, persistence, and lifecycle.
- `disk`: virtual disk creation and management.
- `media`: ISO selection, image catalogues, downloads, and verification.
- `console`: graphical console sessions and authentication.
- `net`: networking configuration and capability detection.
- `commands`: Tauri command handlers.
- `error`: shared application errors.

Adapt this structure to the actual implementation rather than creating empty modules without purpose.

## Virtualization Requirements

- Detect actual host capabilities instead of assuming they exist.
- Use KVM on Linux only when its availability and accessibility are established.
- Support QEMU's software emulation fallback where practical, with clear performance warnings.
- Never require running Wave VM as root.
- Never claim a VM is running without evidence from the actual process and runtime state.
- Use QEMU through safely constructed argument vectors, never shell command strings.
- Use explicit virtual disk formats and validated configuration.
- Use QMP for supported lifecycle operations instead of injecting commands through the human monitor.
- Handle process termination, timeouts, stale runtime resources, and failures explicitly.
- Bind QMP and VNC services to appropriate local interfaces only.
- Never expose unauthenticated virtualization control interfaces to the network.

A genuine interactive graphical guest console is required. Static screenshots, simulated terminals, and fake console interfaces are not acceptable substitutes.

## Host And Guest Compatibility

The long-term goal is to support Linux, Windows, and macOS hosts, with Linux distributions and other compatible operating systems as guests.

Android support may be considered later.

Do not claim support for a host platform, guest OS, architecture, accelerator, or feature until the relevant implementation has been verified.

Do not hardcode Ubuntu-specific assumptions.

When a platform or feature is unsupported, report that explicitly and explain the limitation.

## Storage And Operating System Images

- Store application data using platform-appropriate application data directories.
- Keep VM definitions and disk files organized and understandable.
- Use atomic configuration writes where appropriate.
- Version persisted configuration and provide a migration path.
- Clearly distinguish deleting a VM definition from deleting its associated disk files.
- Protect existing user data from accidental deletion.
- Support local ISO selection and eventually downloads from trustworthy sources.
- Verify image checksums or signatures when reliable verification data is available.
- Never silently overwrite existing disk images or VM data.
- Do not bundle complete guest operating system images.

## Security

- Validate user-controlled input in Rust.
- Canonicalize and validate filesystem paths where appropriate.
- Avoid shell invocation and command injection.
- Minimize Tauri permissions and capabilities.
- Use a restrictive Content Security Policy.
- Do not load remote web content into privileged application windows.
- Avoid exposing arbitrary QEMU arguments to users.
- Do not silently elevate privileges or modify system configuration.
- Never store console passwords as persistent VM configuration.
- Treat imported disk images and ISO files as untrusted inputs.
- Include required third-party licensing notices for distributed dependencies.

## Frontend And Design

The interface should feel like a polished, serious desktop application.

Priorities:
- Clear visual hierarchy.
- Simple navigation.
- Consistent spacing and typography.
- Informative VM states and resource information.
- Accessible controls and useful feedback.
- Beginner-friendly explanations of technical problems.
- Restrained, ocean-inspired visual identity.

Avoid excessive gradients, neon effects, cyberpunk styling, gratuitous blur, clutter, and generic AI-generated interface patterns.

Do not add buttons that imply functionality that does not exist. Clearly communicate unavailable and future features.

Use vanilla JavaScript modules and ordinary CSS. Keep UI components and application logic organized.

## Development Workflow

Before making changes:
1. Inspect the relevant existing files and current implementation.
2. Check Git status before modifying the repository.
3. Understand existing behavior and identify the smallest appropriate change.
4. Explain significant architectural decisions and trade-offs.

When implementing:
- Work incrementally toward a functional end-to-end application.
- Prefer working vertical slices over disconnected UI components.
- Preserve existing work.
- Keep changes scoped to the requested milestone.
- Avoid unrelated refactoring and unnecessary dependencies.
- Do not silently expand the project scope.

After implementing:
- Run relevant formatting, compilation, build, and static checks.
- Report which checks actually ran and their results.
- Distinguish implementation errors from missing host dependencies.
- Summarize changed files, completed functionality, limitations, and the next recommended step.

## Explicit Restrictions

Unless explicitly authorized by the user:
- Do not add automated tests.
- Do not perform scenario testing; the user handles scenario testing.
- Do not commit or push changes.
- Do not create tags or publish releases.
- Do not perform destructive Git operations.
- Do not delete user data or overwrite existing disk images.
- Do not execute privileged commands or change system configuration without authorization.

Never claim an operation succeeded unless its result has been verified.

## Completion Standard

A feature is complete only when its actual implementation exists, relevant checks pass, and its limitations are documented.

The first major product objective is a reliable VM lifecycle: detect host capabilities, create and persist a VM definition, create a virtual disk, launch QEMU, establish runtime control, display the guest through a genuine interactive console, and shut down cleanly.

Do not describe Wave VM as capable of running virtual machines until that workflow is genuinely implemented and verified.
