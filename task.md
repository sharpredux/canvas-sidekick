# Canvas Widget Task Tracker

## Phase 1 Checklist
- [x] Update `electron/main.js` to expose an IPC handler `open-canvas-login` that opens a new `BrowserWindow`.
- [x] When that window navigates to a successful Canvas dashboard page, extract the `canvas_session` cookie.
- [x] Save that cookie securely.
- [x] Create a `preload.js` with `contextBridge` exposing `window.api.loginCanvas()`.
- [x] Update `main.js` webPreferences to use this preload script securely (contextIsolation: true, nodeIntegration: false).
