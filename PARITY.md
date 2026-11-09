# Acceptance record

The Electron UI is the specification. Preserve its controls, layouts, states, hover, focus, compact variants, errors, and animations. Do not introduce visual refinements or extra features.

| Area | Implementation and evidence | Remaining acceptance |
| --- | --- | --- |
| Canvas | Pagination, batches of 20, self/embedded fallback, tracking, announcements/comments/Zoom; six mock-server tests pass | Real account task display after final candidate migration |
| Completion | Overrides, remote reconciliation, cache and estimates; 2,568 differential cases pass | Final UI interaction review |
| Agenda/schedule rules | 37 differential scenarios, 144 items per agenda scenario pass | None identified in tested rules |
| Storage | Exclusive owner, atomic saves/import, corruption detection, retained unknown fields, UTC archive deduplication | Packaged upgrade/recovery checks |
| Migration | Synthetic export → Rust import → keyring passes; source hashes unchanged; no plaintext session file | Packaged runtime path and real transfer after closing old apps |
| Credentials | Secret Service and DPAPI implementations; Linux roundtrip and cookie rotation/expiry tests pass | Windows runtime test |
| Login | Native HttpOnly/redirect/HTML checks pass; live DLSU SSO passes; full mock handoff reaches native task state | Final visual states and cancel/failure recovery review |
| Six tabs | Implemented; captures of 54 tab/size/text-scale combinations | Full comparison; captures alone are not acceptance |
| Task cards | Source metrics/fonts/colors, local completion, swipe/double-click/deletion | Final animation, clipping and edge-case review |
| Task form | Creation and date selection implemented | Exact geometry, datetime popup and validation appearance |
| Calendar | Heatmap, navigation, compact/day detail, archive merge, schedule import | Day-detail and import visual states |
| Settings | Source card grouping, size/text selectors, startup toggle, anchored sync footer | Popup/hover/focus across scales, startup cutover verification |
| AI | Ollama status/pull/chat/router/estimator; native keyboard reaches mocked chat | Offline/pull/error/long-chat/action visual review |
| Linux window | Rounded input, compositor fallback, EWMH states, X11/XWayland default, work-area fitting | Dragging, compositor changes, fractional display-scale review |
| Native host | Full app parenting, hidden startup, bounds/visibility, task roundtrip, pointer/keyboard and shutdown pass | Actual Command Center visual/launcher review and default switch |
| Command Center | Opt-in integration; 28 existing tests pass | Packaged native resources |
| Windows | Desktop/power/session hooks, DPAPI, font/zoom/geometry branches implemented | Build/runtime validation; WorkerW, Show Desktop and sleep/lock explicitly pending |
| Distribution | Not released | RPM, AppImage, NSIS, portable builds and smoke checks |

Do not mark the rebuild complete or replace the installed version while required acceptance work remains. Windows runtime checks stay pending until a machine is available; never represent an unexecuted check as passing.
