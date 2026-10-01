# Canvas Sidekick

Canvas Sidekick is a compact desktop widget for Canvas LMS assignments, announcements, schedules, Zoom links, and an optional local Ollama study assistant.

## Platform support

- Linux: X11 and XWayland desktop-widget integration, plus RPM and AppImage packages
- Windows: WorkerW/Rainmeter-style desktop embedding and NSIS/portable packages

On Linux, the widget remains interactive while requesting the standard EWMH `below`, `sticky`, `skip taskbar`, and `skip pager` states. Native Wayland does not allow applications to control their global position or stacking, so Linux launches through X11/XWayland by default. Set `CANVAS_SIDEKICK_NATIVE_WAYLAND=1` to opt out and use normal Wayland window behavior.

## Run from source

Requirements:

- Node.js 20 or newer
- npm
- Ollama on `127.0.0.1:11434` for the optional AI tab

```bash
npm install
npm run dev:app
```

The widget starts near the upper-right corner of the primary display. Drag the top bar to reposition it.

## Build

Build the web bundle:

```bash
npm run build
```

Build Linux packages:

```bash
npm run dist:linux
```

Artifacts are written to `release/`. The Linux build produces:

- AppImage for portable use
- RPM for Fedora, RHEL, and openSUSE

Build Windows packages with `npm run dist:win` on Windows or in an appropriately configured cross-build environment.

## Linux autostart

Use the **Launch on startup** switch in Settings. On Linux this creates or removes:

```text
~/.config/autostart/canvas-sidekick.desktop
```

Canvas login cookies are encrypted through Electron `safeStorage` before being saved to the application data directory.

## Task completion

Canvas tasks are checked off using your own submission or excused status. Class-wide submission flags, assignment type alone, and missing-work grades do not mark a task done. Paper and external-tool grades count when they indicate completed work. Assignments already fetched remain tracked after they leave Canvas's upcoming list.

Click a task to change its local completion status. Both checked and unchecked choices survive refreshes and restarts; a later change to the Canvas submission status replaces the older local choice. Local checkboxes do not submit work to Canvas.

Run completion, pagination, fallback, and persistence regression checks with `npm test`.
