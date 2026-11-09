# Canvas Sidekick — Rust rebuild

This is the native Rust implementation candidate for Canvas Sidekick 0.1.7. The requirement is the same features, appearance, and interactions as Electron, with the user's explicit exception allowing the candidate's current glassy edge finish and widget curvature. There are no added product features. It stays alongside the existing app until the checks in [PARITY.md](PARITY.md) pass. Capturing screenshots does not mean visual parity has passed.

The frozen reference is commit `ae211ff98ac374685e94ad81c8ff905d9cb285f4` plus the captured working-tree patch in `baseline/`. `baseline/manifest.json` records hashes; `baseline/reference/` contains the original source. The original Sidekick checkout and installed profile are unchanged. Command Center has an opt-in native adapter; its original main file is saved in `baseline/command-center-main.cjs`.

## Build and run

Build the app with `cargo build --locked --bin canvas-sidekick`, and its login helper with `cargo build --locked --no-default-features --features auth --bin canvas-sidekick-auth`. Keep both executables in the same directory. Run `target/debug/canvas-sidekick`.

Linux needs GTK3/WebKitGTK 4.1 development packages to build the helper, and libsecret's `secret-tool` at runtime. This Fedora workspace uses the ignored `.sdk/` directory prepared by `tools/prepare-local-sdk.py`; it does not install system packages. Builds use one job to limit memory use.

The Rust profile is `~/.config/canvas-sidekick-rust` on Linux or `%APPDATA%/canvas-sidekick-rust` on Windows. `--profile PATH` selects an isolated profile. First launch transfers existing Electron data through a temporary export runtime. Both old apps must be closed. Tasks, settings, overrides, estimates, schedules, unknown fields, and archives are preserved; import commits atomically without changing the source.

Sessions use Linux Secret Service or Windows DPAPI. Cookies, including renewal and expiry, are never written to plaintext profile files. The login helper exchanges session data over private pipes; never redirect its stdout to a terminal or log.

## Verification

- `bash tools/validate.sh`: core/network/migration regressions plus JavaScript/Rust differential checks.
- `cargo test --locked --bin canvas-sidekick`: native gesture regressions.
- `cargo test --locked --test native_window -- --ignored --test-threads=1`: graphical X11 geometry, shape, parenting and resize tests.
- `python3 tools/auth-gate.py`: isolated native HttpOnly sign-in verification.
- `python3 tools/legacy-export-gate.py`: synthetic export, atomic import, protected credentials and unchanged-source checks.
- `python3 tools/login-handoff-gate.py`: full native sign-in → Sidekick assignment handoff.
- `python3 tools/host-gate.py`: full native host, task roundtrip, real pointer/keyboard input, visibility/resize and shutdown.
- `node tools/command-center-gate.mjs`: actual Command Center navigation, task-checkbox sync, native resize/visibility and child shutdown.
- `python3 tools/ui-gate.py --matrix --details` then `node tools/reference-capture.mjs --details --picker --year --required`: original tab/size/text-scale combinations plus form, datetime/year/validation popups, calendar details, schedule import, AI setup and authentication states. The gates verify actual viewport dimensions and retain separate standalone/hosted fixtures.
- Add `--hosted` to both capture commands to compare Command Center's appearance. Add `--medium` to the reference command for a quick single-preset review.
- `python3 tools/ui-gate.py --small --details --edge`: verify the full datetime popup extends beyond the compact widget, stays usable at the screen edge, and closes when the widget hides. The detail captures retain the complete datetime/year popup surfaces for comparison with Electron.
- `python3 tools/package-smoke.py`: extract the candidate RPM/AppImage and exercise their release windows, restart/data retention, corruption preservation/recovery, mounted AppImage launcher, migration bridge, dependencies and login helper.
- `python3 tools/visual-report.py`: generate `artifacts/parity-report/index.html` with Electron/Rust overlays and raw pixel measurements. Approved glass/curvature differences remain visible in these measurements.

Integration scripts require a graphical desktop and unlocked keyring. They use temporary profiles, mock services and synthetic credentials, then clean up their entries. Real DLSU SSO already passed; its temporary session was discarded. Captures go to ignored `artifacts/native/` and `artifacts/reference/`. Additional state and popup comparisons remain necessary.

## Command Center

`python3 tools/integrate-command-center.py` installs the opt-in adapter. Run Command Center with `CANVAS_SIDEKICK_RUST=1`, `CANVAS_SIDEKICK_EXECUTABLE` set to the absolute native executable, and optionally `CANVAS_SIDEKICK_PROFILE` pointing to an already initialized Rust profile. The default remains the existing Electron view. Complete standalone migration first: Command Center still owns the legacy profile lock for its other encrypted integrations.

The adapter uses versioned JSON lines on private child-process pipes. Hosted styling preserves the mint palette and Manrope faces. The full native host test passes; Command Center's 28 existing regression tests also pass.

## Candidate packages

`python3 tools/package-linux.py` builds both release executables, then writes a parallel-install RPM and AppImage to `artifacts/packages/`. `--skip-build` packages an existing release build. SHA-256 checksums and platform/dependency information are recorded in `manifest.json`. No package is installed automatically.

The Linux AppImage uses system GTK3, WebKitGTK 4.1, `secret-tool`, and graphics libraries. The current Fedora-built candidate requires glibc 2.43; it is not validated on older Linux distributions. Both packages retain the migration bridge and dependency/font notices. Keep the old Electron runtime available until migration succeeds.

On Windows, run `tools/package-windows.ps1` with Rust, Python, NSIS and the WebView2 Runtime available. It prepares a per-user installer and a single-file portable wrapper that extracts both native executables together. These recipes have not been built or tested on Windows.

Command Center has an explicit candidate packaging configuration at `integrations/command-center/electron-builder-native.cjs`. Build the Rust release first, run `python3 tools/integrate-command-center.py`, then run Electron Builder from the Command Center directory with that configuration. Candidate output goes to this repository's `artifacts/command-center-package/`; its ordinary build configuration and default Electron route remain unchanged. `node tools/command-center-gate.mjs --packaged PATH` checks the actual candidate AppImage with isolated data.

Windows WorkerW, Show Desktop, and sleep/lock recovery validation remain pending by explicit user choice. No final cutover or Windows replacement is claimed.

