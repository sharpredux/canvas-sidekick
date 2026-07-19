# E2E Test Infrastructure & Refinements Test Suite

This document outlines the test architecture, mocking strategy, and detailed test case inventory for the Canvas Sidekick E2E test suite implemented in `verify-refinements-e2e.js`.

---

## 1. Test Architecture

The E2E test suite operates as a standalone Node.js process using Playwright to verify the Canvas Sidekick application in a simulated environment.

```
                  +-----------------------------------+
                  |      verify-refinements-e2e.js    | (Node script runner)
                  +-----------------------------------+
                       /                         \
         1. Spawns    /                           \ 2. Launches
                     v                             v
           +-------------------+         +--------------------+
           |  Local Vite Dev   |         | Playwright Browser |
           |  Server (p:5173)  |         | (Chromium Instance)|
           +-------------------+         +--------------------+
                     ^                             |
                     |                             | 3. Injects init scripts
                     |                             v
                     |                    +--------------------+
                     +--------------------+   Page Context     | (Overridden window.Date,
                        4. Navigates to   |    with Mocks      |  window.api, intervals)
                                          +--------------------+
```

### Flow description:
1. **Server Launch**: The runner spawns the local Vite dev server on port `5173`.
2. **Browser Startup**: The runner launches a headless Chromium instance via Playwright.
3. **Mock Injection**: Using Playwright's `page.addInitScript`, the runner overrides `window.Date`, the Electron `window.api` IPC bridge, and the window's `setInterval`/`clearInterval` functions.
4. **Navigation & Login**: The runner navigates to `http://localhost:5173` and performs a mock login to bypass the connection overlay.
5. **Execution**: The runner runs 28 distinct test cases sequentially, logging individual results and clean-up actions.
6. **Teardown**: The browser is closed, the Vite server process is killed, and the script exits with code `0` on success or `1` on failure.

---

## 2. Mocking Strategy

### 2.1 Time and Date Mocking
To achieve deterministic test results for temporal filters (e.g. midnight rollover, task removal at deadline), we override the global `window.Date` constructor and `window.Date.now()`:
- A reactive property `window.__fakeTime` is defined.
- `MockDate` extends the native `Date` class. If called with no arguments (or `undefined`), it defaults to `window.__fakeTime`. If called with arguments, it delegates to the native `Date` constructor to parse specific timestamps correctly.
- Helper hooks `window.__setFakeTime(timestamp)` and `window.__advanceFakeTime(ms)` allow tests to dynamically shift time forward or backward.

### 2.2 Electron IPC Bridge Mocking (`window.api`)
Since the application runs inside an Electron environment, `window.api` acts as the IPC bridge. We mock this bridge to intercept frontend requests and push simulated backend updates:
- **`fetchCanvasData`**: Resolves to a mock data array that tests can override.
- **`onCanvasFetchOccurred(callback)`**: Saves the callback to `window.__fetchOccurredListener` and returns an unsubscribe function.
- **`onCanvasDataUpdate(callback)`**: Saves the callback to `window.__dataUpdateListener` and returns an unsubscribe function.
- **`loadSettings`**: Returns a configurable settings object (e.g., `{ size: 'Medium', schoolUrl: 'https://canvas.edu' }`).
- **`saveSettings`, `resizeWindow`, `saveSchedule`, `loadSchedule`**: Track arguments in a spy registry (`window.__spy`) to verify correct parameters are passed.

### 2.3 Interval & Memory Leak Tracing
To verify React timer cleanup and prevent memory leaks:
- We override `window.setInterval` and `window.clearInterval`.
- A map `window.__activeIntervals` tracks all active timers.
- When `setInterval` is called, we register the timer ID, the callback, and the timeout.
- When `clearInterval` is called, we remove it from the map.
- The E2E test can invoke `window.__getActiveIntervals()` to ensure the Settings sync timer (`30000ms` duration) is instantiated only when the Settings tab is active, and is completely cleaned up upon unmounting.

---

## 3. Test Case Inventory

### Tier 1: Feature Coverage (10 Test Cases)

- **T1.1: Past Event Removal (Up Next)**
  - *Description*: Verify that meeting links (`type === 'event'`) scheduled for previous days are hidden from the "Up Next" view.
- **T1.2: Completed Task Removal (Up Next)**
  - *Description*: Verify that completed tasks (`type === 'deadline'`, `completed: true`) whose exact deadline has passed are hidden.
- **T1.3: Overdue Task Retention (Up Next)**
  - *Description*: Verify that incomplete tasks (`completed: false`) whose deadline has passed (overdue) are retained.
- **T1.4: Past Event Retention in Calendar**
  - *Description*: Verify that past events are still visible in the "Calendar" view.
- **T1.5: Completed Task Retention in Calendar**
  - *Description*: Verify that completed past tasks are still visible in the "Calendar" view.
- **T1.6: Refresh Indicator - Just Now**
  - *Description*: Verify that receiving a fresh sync timestamp displays "Just now" on the Settings tab.
- **T1.7: Refresh Indicator - Minutes Ago**
  - *Description*: Verify that as time passes, the indicator correctly shows "Xm ago".
- **T1.8: Refresh Indicator - Pre-sync Default**
  - *Description*: Verify that before any Canvas sync has taken place, the indicator displays "v0.0.0".
- **T1.9: IPC Event Listening**
  - *Description*: Verify that the renderer correctly subscribes to `canvas-fetch-occurred` and updates the internal state.
- **T1.10: Force Sync Reset**
  - *Description*: Verify that clicking the "Force Sync" button triggers a sync and resets the indicator to "Just now".

### Tier 2: Boundary & Corner Cases (10 Test Cases)

- **T2.1: Midnight Boundary Event Filtering**
  - *Description*: Verify that an event scheduled for 23:59:59 of yesterday is filtered out, while an event scheduled for 00:00:01 of today is kept.
- **T2.2: Task Removal Exact Deadline Boundary**
  - *Description*: Verify that a completed task is visible at `deadline - 1ms` but hidden exactly at `deadline` and `deadline + 1ms`.
- **T2.3: System Timezone Shift Correctness**
  - *Description*: Verify that changing the browser timezone does not cause task deadlines to disappear early or late due to timezone mismatches.
- **T2.4: Empty/Null Due Dates Handling**
  - *Description*: Verify that items with missing or invalid due dates do not crash the filtering code and are handled gracefully.
- **T2.5: Multi-Day Overdue Task Persistence**
  - *Description*: Verify that an incomplete task due 7 days ago remains visible in "Up Next" and "Tasks" views.
- **T2.6: Interval Drift and Clock Jump Backward**
  - *Description*: Verify that if the user's system clock jumps backward (e.g. Daylight Saving Time end), the minutes-ago calculation handles it gracefully (clips to 0m ago/Just now).
- **T2.7: Clock Jump Forward**
  - *Description*: Verify that if the system clock jumps forward, the minutes-ago display reflects the correct elapsed time immediately.
- **T2.8: Failed Sync Indicator Preservation**
  - *Description*: Verify that when a force sync fails, the refresh indicator maintains its last known successful sync timestamp.
- **T2.9: Rapid Multiple Fetch Occurrences (Flooding)**
  - *Description*: Verify that sending rapid, successive `canvas-fetch-occurred` events does not cause UI lag or breakdown.
- **T2.10: Startup State Race Condition**
  - *Description*: Verify that if a fetch occurs before the Settings tab is ever mounted, the cached timestamp in App state is correctly adopted when Settings is later opened.

### Tier 3: Cross-Feature Combinations (3 Test Cases)

- **T3.1: Tab Switch and Settings Interval Cleanup (Memory Leak Verification)**
  - *Description*: Verify that the relative sync timer interval in Settings is active when in the Settings tab, and completely destroyed when switching tabs.
- **T3.2: Background Poll during Active Settings Timer**
  - *Description*: Verify that when a background poll occurs while the user is actively viewing the Settings tab, the timer resets its relative duration immediately.
- **T3.3: Task Completion and Midnight Rollover Intersection**
  - *Description*: Verify that completing an overdue task makes it disappear immediately, and crossing midnight cleans up past events without interfering with the completed task states.

### Tier 4: Real-World Scenarios (5 Test Cases)

- **T4.1: The Idle Student Midnight Rollover**
  - *Description*: A student leaves the widget open on their desktop overnight. Past events from the previous day should disappear without manual app restarts when background polls occur.
- **T4.2: The Overdue Submission Flow**
  - *Description*: A student completes an assignment 1 hour after the deadline has passed. It should be visible as overdue, then disappear immediately upon completion.
- **T4.3: Initial Onboarding and Sync Transitions**
  - *Description*: A new user opens the app (shows v0.0.0), logs in, and the widget fetches initial data, updating the sync indicator.
- **T4.4: Network Drop and Offline Recovery**
  - *Description*: The user goes offline. The background polls fail. The widget retains cached data and displays correct time-since-last-sync. Once connection is restored, sync succeeds and indicator resets.
- **T4.5: The Smartwatch Widget (Small Size) Constraint**
  - *Description*: When widget is resized to Small (200x200), only a single item is shown, and all sub-text details (estimates, previews, authors) are hidden to prevent UI squashing, while maintaining smooth transitions.
