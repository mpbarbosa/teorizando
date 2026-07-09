# Roadmap — Dark Text Overlay

**Project:** Dark Text Overlay  
**Type:** Manifest V3 Browser Extension (Chrome / Chromium)  
**Status:** Active — Personal / Educational use  

---

## Current State (v0.1.1)

The extension is functional and installed in developer mode. Core features delivered:

- ✅ Shadow DOM overlay injected into Netflix watch pages
- ✅ Layers configurable via popup (text, position, font size, colour)
- ✅ Time-based layer display (`startTime` / `endTime` keyed to `video.currentTime`)
- ✅ Chronometer layer (`MM:SS` live counter from video position)
- ✅ Preset storage per Netflix title ID (`chrome.storage.local`)
- ✅ Default preset seeded on first install (`default-presets.json`)
- ✅ Fallback: episode watch ID → parent show title ID
- ✅ SPA navigation detection (Netflix client-side routing)
- ✅ Visibility toggle (show/hide all layers without deleting)
- ✅ Dark S1E1 presets: 8 timed annotations (Newton & Aristóteles time quotes, porta de ferro/bunker, Michael/Mikkel identity, Kahnwald residence, Michael's suicide & the time loop, Mikkel's disappearance, young Jonas, amitriptilina) — each with a red highlight rectangle

---

## Milestone 1 — Quality & Reliability ✅

> Goal: Make the extension robust enough for daily use without surprises.

| # | Feature | Notes |
|---|---------|-------|
| 1.1 | **ESLint CI** | Run `npm run lint` in a GitHub Actions workflow on every push |
| 1.2 | **Unit tests** | Test `formatTime`, `getVisibleLayers`, `getTitleIdFromUrl`, `layerKey` with Jest + jest-chrome |
| 1.3 | **Timer cleanup** | Disconnect `MutationObserver` and clear `setInterval` on page unload / SPA exit |
| 1.4 | **Storage quota guard** | Warn user in popup when the `chrome.storage.local` preset payload approaches its quota (~5 MB) |
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

## Milestone 3 — Multi-Preset & Export ✅

> Goal: Support richer per-series annotation workflows.

| # | Feature | Notes |
|---|---------|-------|
| 3.1 | **Multiple named presets per title** | Allow saving several named preset configurations per title ID (e.g. "Annotations", "Quotes") |
| 3.2 | **Preset import/export** | Export all presets to JSON; import from JSON file |
| 3.3 | **Preset library** | Popup screen to browse, rename, delete, and activate saved presets |
| 3.4 | ~~**Cross-device sync**~~ | Superseded: storage moved to `chrome.storage.local` for capacity (large per-episode presets exceed sync's 8 KB-per-key cap). Cross-device sync dropped as the trade-off. |
| 3.5 | **Default preset editor** | Edit `default-presets.json` entries directly from the popup without reloading the extension |

---

## Milestone 4 — Content Authoring ✅

> Goal: Make it practical to author rich, time-locked annotations for educational viewing.

| # | Feature | Notes |
|---|---------|-------|
| 4.1 | **Draggable layers** ✅ | Drag mode toggle in popup header; layers become interactive on the video; position synced back via `LAYER_MOVED` message |
| 4.2 | **Rich text support** ✅ | `**bold**` and `*italic*` markdown parsed to HTML; opt-in per layer with "Rich text" checkbox |
| 4.3 | **Image / icon layers** ✅ | New `type:"image"` layer with URL, width/height, opacity; rendered as `<img>` in Shadow DOM |
| 4.4 | **Layer groups** ✅ | `group` field on any layer; Groups panel with per-group show/hide toggle |
| 4.5 | **Timeline view** ✅ | Collapsible timeline in popup with colour-coded bars per layer type and a time ruler |
| 4.6 | **Geometric shape layers** ✅ | SVG-based shapes (rect/circle/ellipse/line/arrow/triangle); fill, stroke, strokeWidth, opacity |
| 4.7 | **Shape + text composition** ✅ | Optional `label` field on shape layers renders a caption below the shape |
| 4.8 | **Shape animation presets** ✅ | `animation` field on shapes: `fade-in`, `scale-in`, `draw-on` (animated stroke) |

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

## Developer Health (Minor / Ongoing)

> Items surfaced by ai_workflow code review — low effort, improves long-term maintainability.

| # | Item | Notes |
|---|------|-------|
| D1 | **JSDoc on overlay.js and popup.js** | `overlay-utils.js` already has JSDoc; extend to the other two files |
| D2 | **CHANGELOG.md** | Track breaking changes and notable additions per release |
| D3 | **CONTRIBUTING.md** | Setup guide, branch conventions, how to run tests and linter |
| D4 | **LICENSE file** | `package.json` declares MIT but no `LICENSE` file exists in the repo |
| D5 | **docs/README.md** | Index page listing all docs with one-line descriptions |
| D6 | **Module refactor for full test coverage** | `overlay.js` and `popup.js` are IIFE/browser scripts; export pure functions so ai_workflow-generated test drafts (`test/content/`, `test/popup/`) can run under Jest |

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
| v0.1.1 | Initial implementation: static layers, storage, SPA nav detection |
| v0.1.1 | Time-based `startTime`/`endTime` layer support |
| v0.1.2 | Chronometer layer (`MM:SS`) |
| v0.1.3 | Dark S1E1 presets — 8 timed annotations (time quotes, bunker door, character/location labels, plot notes) with highlight rectangles |
| v0.1.4 | ESLint, package.json, `.workflow-config.yaml` for ai_workflow.js integration |
| v0.2.0 | Multi-preset per title, import/export JSON, preset library, cross-device sync, factory-default restore |
| v0.3.0 | Shape layers (SVG), image layers, rich text, layer groups, timeline view, drag-to-reposition on video, shape animations |
