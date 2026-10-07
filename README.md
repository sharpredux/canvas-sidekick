# Canvas Sidekick

Canvas Sidekick is a compact desktop widget for Canvas LMS assignments, announcements, schedules, Zoom links, and an optional local Ollama study assistant.

## Platform support

- Linux: X11 and XWayland desktop-widget integration, plus RPM and AppImage packages
- Windows: WorkerW/Rainmeter-style desktop embedding and NSIS/portable packages

On Linux, the widget remains interactive while requesting the standard EWMH `below`, `sticky`, `skip taskbar`, and `skip pager` states. Native Wayland does not allow applications to control their global position or stacking, so Linux launches through X11/XWayland by default. Set `CANVAS_SIDEKICK_NATIVE_WAYLAND=1` to opt out and use normal Wayland window behavior.

X11/XWayland windows use antialiased rounded transparency when a desktop compositor
is active. Only the input region is clipped, so empty corners pass clicks through
without cutting off the smooth visual edge. If compositing is disabled, a native
rounded cutout keeps corners clear, but cannot blend edge pixels. Enable desktop
compositing for smooth corners and dragging. The widget adapts to compositor
changes without restarting. Native Wayland uses the renderer's rounded transparency.

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

## Linux sizing and text

Settings provides three window sizes, measured in logical desktop pixels:

| Size | Width | Height |
|---|---:|---:|
| Small | 280 | 320 |
| Medium | 360 | 520 |
| Large | 480 | 640 |

Medium is the default. Small uses tighter spacing and hides secondary previews;
Large provides wider cards and more visible content. Windows retains its original sizes.
Linux windows fit within the display work area, including when changing size near an edge.

The Connect to Canvas screen scales its logo, typography, controls, and spacing with
the selected widget size, while respecting the Linux text-size preference. The URL
field uses two-thirds of the form width and the login button uses 28.8% (60% narrower
than before). The close button stays in the top-right corner at every size.

The Linux **Text size** setting is independent of window size: Standard (100%, the
default), Larger (112.5%), or Largest (125%). Both preferences survive restarts.
Linux uses local Noto Sans / DejaVu Sans fonts and 100% application zoom, allowing
desktop display scaling to control pixel density without further shrinking text.

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

Run the Electron layout and preference checks with `npm run test:widget-ui` from a
Linux graphical session. They use isolated temporary application data and mocked
Canvas/Ollama services. Set `WIDGET_DISPLAY_SCALE=1.25` or `1.5` to check fractional
display scaling; set `WIDGET_EXECUTABLE` to an unpacked or installed Linux executable
to test the packaged app. Screenshots are saved in the temporary test directory.

Run `npm run test:widget-corners` in an X11 graphical session to check the actual
native input regions and visual edges on cold launches, resizing, reloads, and a
real mouse drag. With compositing active it verifies partially transparent edge
pixels on the X11 surface; otherwise it checks the fallback cutout. This check
requires the X11, Xext, and Xtst libraries. It also supports `WIDGET_DISPLAY_SCALE`
and `WIDGET_EXECUTABLE` and uses isolated application data.
