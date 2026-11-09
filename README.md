# Canvas Sidekick — Rust rebuild

This is the native Rust implementation candidate for Canvas Sidekick 0.1.7. The requirement is the same features, appearance, and interactions as Electron, with no redesign or added product features. It stays alongside the existing app until the checks in [PARITY.md](PARITY.md) pass. Capturing screenshots does not mean visual parity has passed.

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
- `SIDEKICK_UI_MATRIX=1 python3 tools/ui-gate.py` then `node tools/reference-capture.mjs`: matching fixture/clock captures for all 54 tab/size/text-scale combinations.

Integration scripts require a graphical desktop and unlocked keyring. They use temporary profiles, mock services and synthetic credentials, then clean up their entries. Real DLSU SSO already passed; its temporary session was discarded. Captures go to ignored `artifacts/native/` and `artifacts/reference/`. Additional state and popup comparisons remain necessary.

## Command Center

`python3 tools/integrate-command-center.py` installs the opt-in adapter. Run Command Center with `CANVAS_SIDEKICK_RUST=1`, `CANVAS_SIDEKICK_EXECUTABLE` set to the absolute native executable, and optionally `CANVAS_SIDEKICK_PROFILE` pointing to an already initialized Rust profile. The default remains the existing Electron view. Complete standalone migration first: Command Center still owns the legacy profile lock for its other encrypted integrations.

The adapter uses versioned JSON lines on private child-process pipes. Hosted styling preserves the mint palette and Manrope faces. The full native host test passes; Command Center's 28 existing regression tests also pass.

Windows WorkerW, Show Desktop, and sleep/lock recovery validation remain pending by explicit user choice. No final cutover or Windows replacement is claimed.

