# Acceptance record

The Electron UI is the specification. Preserve its controls, layouts, states, hover, focus, compact variants, errors, and animations. The user explicitly approved keeping the Rust candidate's current glassy edge finish and widget curvature. Those two visual differences are accepted; other UI changes and extra features are outside scope.

| Area | Implementation and evidence | Remaining acceptance |
| --- | --- | --- |
| Canvas | Pagination, batches of 20, self/embedded fallback, tracking, announcements/comments/Zoom; six mock-server tests pass | Real account task display after final candidate migration |
| Completion | Overrides, remote reconciliation, cache and estimates; 2,568 differential cases pass | Final UI interaction review |
| Agenda/schedule rules | 37 differential scenarios, 144 items per agenda scenario pass | None identified in tested rules |
| Storage | Exclusive owner, atomic saves/import, corruption detection, retained unknown fields, UTC archive deduplication; extracted Linux packages pass restart/data-retention and corruption-preservation/recovery checks | Real-profile upgrade acceptance |
| Migration | Synthetic export → Rust import → keyring passes with both development and installed packaged Electron runtimes; source hashes unchanged; no plaintext session file | Real transfer after closing old apps; Windows migration runtime |
| Credentials | Secret Service and DPAPI implementations; Linux roundtrip and cookie rotation/expiry tests pass | Windows runtime test |
| Login | Native HttpOnly, redirect/HTML/invalid-profile rejection and immediate navigation failure pass; live DLSU SSO passes; full mock handoff reaches native task state | Final visual review; Windows cancellation/navigation failure |
| Six tabs | All nine size/text combinations captured with verified viewport dimensions; extra form/import/day/AI/auth states captured against Electron | Complete visual comparison, including text rasterization, hover, focus and popup details; captures alone are not acceptance |
| Task cards | Source metrics/fonts/colors, local completion, swipe/double-click/deletion | Final animation, clipping and edge-case review |
| Task form | Real pointer/keyboard creation persists and reaches the host; calendar/hour/minute/AM-PM/clear regression passes; separate 392×282 datetime/year window matches Electron's popup dimensions, permits real date selection beyond the compact owner, flips at screen edges and closes when its owner hides | Complete datetime popup and validation visual comparison across sizes/platforms; Windows popup runtime |
| Calendar | Heatmap, navigation, compact/day detail, archive merge, schedule import; grid gaps, circle width limits, navigation icon size and scroll padding match Electron; compact import headings retain one line when space permits | Final day-detail/import and scroll interaction review |
| Settings | Source card grouping, size/text selectors, startup toggle, anchored sync footer | Popup/hover/focus across scales, startup cutover verification |
| AI | Ollama status/pull/chat/router/estimator; native keyboard reaches mocked chat | Offline/pull/error/long-chat/action visual review |
| Linux window | Rounded input, compositor fallback, EWMH states, X11/XWayland default, work-area fitting | Dragging, compositor changes, fractional display-scale review |
| Native host | Full app parenting, hidden startup, bounds/visibility, task roundtrip, pointer/keyboard and shutdown pass; actual Command Center navigation, checkbox sync, resize/hide/quit pass | Complete hosted visual comparison and final launcher/default switch |
| Command Center | Opt-in integration; 28 existing tests pass; candidate AppImage includes both executables, migration bridge and notices; packaged navigation, checkbox sync, resize/hide/quit pass | Final visual acceptance and default switch |
| Windows | Desktop/power/session hooks, DPAPI, font/zoom/geometry branches implemented | Build/runtime validation; WorkerW, Show Desktop and sleep/lock explicitly pending |
| Distribution | Linux release RPM/AppImage candidates built; extracted-package restart/data retention, corruption recovery, login helpers and the mounted AppImage launcher pass; Command Center candidate AppImage passes its integration gate; Windows installer/portable recipes prepared | Windows builds/runtime checks; final visual acceptance; no final release |

Do not mark the rebuild complete or replace the installed version while required acceptance work remains. Windows runtime checks stay pending until a machine is available; never represent an unexecuted check as passing.
