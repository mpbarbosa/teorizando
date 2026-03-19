# Roadmap — Dark Text Overlay

**Project:** Dark Text Overlay  
**Type:** Manifest V3 Browser Extension (Chrome / Chromium)  
**Status:** Active — Personal / Educational use  

---

## Current State (v0.1.0)

The extension is functional and installed in developer mode. Core features delivered:

- ✅ Shadow DOM overlay injected into Netflix watch pages
- ✅ Layers configurable via popup (text, position, font size, colour)
- ✅ Time-based layer display (`startTime` / `endTime` keyed to `video.currentTime`)
- ✅ Chronometer layer (`MM:SS` live counter from video position)
- ✅ Preset storage per Netflix title ID (`chrome.storage.sync`)
- ✅ Default preset seeded on first install (`default-presets.json`)
- ✅ Fallback: episode watch ID → parent show title ID
- ✅ SPA navigation detection (Netflix client-side routing)
- ✅ Visibility toggle (show/hide all layers without deleting)
- ✅ Dark S1E1 presets: Newton quote, Aristóteles quote, porta de ferro description

---

## Milestone 1 — Quality & Reliability ✅

> Goal: Make the extension robust enough for daily use without surprises.

| # | Feature | Notes |
|---|---------|-------|
| 1.1 | **ESLint CI** | Run `npm run lint` in a GitHub Actions workflow on every push |
| 1.2 | **Unit tests** | Test `formatTime`, `getVisibleLayers`, `getTitleIdFromUrl`, `layerKey` with Jest + jest-chrome |
| 1.3 | **Timer cleanup** | Disconnect `MutationObserver` and clear `setInterval` on page unload / SPA exit |
| 1.4 | **Storage quota guard** | Warn user in popup if `chrome.storage.sync` preset size approaches 8 KB item limit |
| 1.5 | **Error boundaries** | Graceful degradation when `video` element is not found or `chrome.storage` is unavailable |

---

## Milestone 2 — UX Improvements ✅

> Goal: Make the popup faster and more informative to use.

| # | Feature | Notes |
|---|---------|-------|
| 2.1 | **Layer reordering** | Drag-to-reorder layers in the popup list |
| 2.2 | **Inline layer editing** | Click a layer in the popup to edit its properties in-place (no remove + re-add) |
| 2.3 | **Layer preview** | Show a mini live preview of position/size in the popup |
| 2.4 | **Timing display improvement** | Show `00:11 → 00:17` (formatted) instead of `11s–17s` in the layer badge |
| 2.5 | **Keyboard shortcut** | Toggle overlay visibility with a configurable keyboard shortcut (`chrome.commands`); suggested default: `Alt+Shift+O` |
| 2.6 | **Popup timestamp scrubber** | Show current video time in the popup header so users know where they are |

---

## Milestone 3 — Multi-Preset & Export

> Goal: Support richer per-series annotation workflows.

| # | Feature | Notes |
|---|---------|-------|
| 3.1 | **Multiple named presets per title** | Allow saving several named preset configurations per title ID (e.g. "Annotations", "Quotes") |
| 3.2 | **Preset import/export** | Export all presets to JSON; import from JSON file |
| 3.3 | **Preset library** | Popup screen to browse, rename, delete, and activate saved presets |
| 3.4 | **Cross-device sync** | Leverage `chrome.storage.sync` fully; document quota limits |
| 3.5 | **Default preset editor** | Edit `default-presets.json` entries directly from the popup without reloading the extension |

---

## Milestone 4 — Content Authoring

> Goal: Make it practical to author rich, time-locked annotations for educational viewing.

| # | Feature | Notes |
|---|---------|-------|
| 4.1 | **Draggable layers** | Allow dragging overlay layers on the video with mouse events on the Shadow DOM host |
| 4.2 | **Rich text support** | Support basic markdown-like formatting (bold, italic, line breaks) in layer text |
| 4.3 | **Image / icon layers** | Support overlaying small images or emoji at a position |
| 4.4 | **Layer groups** | Group layers into named scenes that activate/deactivate together |
| 4.5 | **Timeline view** | Visual popup tab showing all timed layers on a scrubable timeline bar |

---

## Milestone 5 — Platform & Distribution

> Goal: Broaden reach and enable collaborative use.

| # | Feature | Notes |
|---|---------|-------|
| 5.1 | **Firefox compatibility** | Manifest V2 shim or `browser` API polyfill for Firefox |
| 5.2 | **Chrome Web Store listing** | Package, test, and publish as an unlisted extension |
| 5.3 | **Preset sharing** | Share preset JSON via URL or QR code (no backend required — encode in URL fragment) |
| 5.4 | **Real-time multi-user sync** | Optional WebSocket backend (Socket.io) to synchronise annotations across viewers in real time |
| 5.5 | **Other streaming platforms** | Extend host_permissions to Prime Video, Disney+, etc. with platform-specific title ID detection |

---

## Out of Scope (Intentionally Deferred)

- User authentication / accounts
- Cloud database for preset storage
- Video subtitle / SRT integration
- Netflix official API (does not exist publicly)

---

## Version History

| Version | Highlights |
|---------|-----------|
| v0.1.0 | Initial implementation: static layers, storage, SPA nav detection |
| v0.1.1 | Time-based `startTime`/`endTime` layer support |
| v0.1.2 | Chronometer layer (`MM:SS`) |
| v0.1.3 | Dark S1E1 presets (Newton, Aristóteles, porta de ferro) |
| v0.1.4 | ESLint, package.json, `.workflow-config.yaml` for ai_workflow.js integration |
