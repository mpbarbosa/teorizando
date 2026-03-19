# Functional Requirements — Dark Text Overlay

**Project:** Dark Text Overlay  
**Type:** Manifest V3 Browser Extension (Chrome / Chromium)  
**Scope:** Display custom, time-synchronized text overlays on top of Netflix streams  

---

## 1. Overview

The extension injects a non-interactive text overlay into the Netflix player page. Overlays are composed of one or more independent **layers**, each configurable in content, position, style, and optional display window. Layers are persisted per Netflix title ID and loaded automatically when the user navigates to a matching watch page.

---

## 2. Actors

| Actor | Description |
|---|---|
| **User** | A person watching Netflix who has installed the extension |
| **Extension Popup** | The browser action UI opened by clicking the extension icon |
| **Content Script** | JavaScript injected into the Netflix page (`overlay.js`) |
| **Service Worker** | Background script that routes messages and seeds default presets |

---

## 3. Functional Requirements

### 3.1 Overlay Injection

| ID | Requirement |
|---|---|
| FR-01 | The extension SHALL inject a fixed-position overlay host into every Netflix watch page (`netflix.com/watch/*` and `netflix.com/title/*`). |
| FR-02 | The overlay host SHALL use Shadow DOM to isolate its styles from Netflix's own CSS. |
| FR-03 | The overlay SHALL be non-interactive (pointer events must pass through to the Netflix player). |
| FR-04 | The overlay SHALL sit above all Netflix UI elements (z-index: 2147483647). |

### 3.2 Layer Model

Each overlay layer is a JSON object with the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | No | `"chronometer"` for a live timer layer; omit for text |
| `text` | string | Yes (if not chrono) | The text content to display |
| `x` | number | Yes | Horizontal position in pixels from the left edge |
| `y` | number | Yes | Vertical position in pixels from the top edge |
| `fontSize` | number | Yes | Font size in pixels |
| `color` | string | Yes | CSS colour value (e.g. `"#ffffff"`) |
| `startTime` | number | No | Video time in seconds at which the layer becomes visible |
| `endTime` | number | No | Video time in seconds at which the layer is hidden |

### 3.3 Time-Based Display

| ID | Requirement |
|---|---|
| FR-05 | Layers without `startTime` and `endTime` SHALL be displayed at all times while on the matching watch page. |
| FR-06 | Layers with `startTime` SHALL only become visible when `video.currentTime >= startTime`. |
| FR-07 | Layers with `endTime` SHALL be hidden when `video.currentTime > endTime`. |
| FR-08 | The content script SHALL poll `video.currentTime` at 500 ms intervals to evaluate layer visibility. |
| FR-09 | The DOM SHALL only be updated when the set of visible layers changes between ticks. |

### 3.4 Chronometer Layer

| ID | Requirement |
|---|---|
| FR-10 | A layer with `"type": "chronometer"` SHALL display the current video position formatted as `MM:SS`. |
| FR-11 | The chronometer SHALL update once per second, driven by the existing 500 ms tick loop. |
| FR-12 | The chronometer SHALL start from `00:00` and reflect the actual `video.currentTime` at all times, including paused state. |

### 3.5 Preset Storage

| ID | Requirement |
|---|---|
| FR-13 | Layer configurations SHALL be stored in `chrome.storage.sync` under the key `nto_presets`, keyed by Netflix title ID. |
| FR-14 | On first install, the extension SHALL seed default presets from `src/default-presets.json` without overwriting any data the user has already configured. |
| FR-15 | On subsequent updates, the default presets SHALL NOT overwrite user-saved presets. |
| FR-16 | When the user is on an episode watch page (`/watch/<id>`), the extension SHALL first look up the episode's own watch ID; if no preset exists, it SHALL fall back to the parent show's title ID. |

### 3.6 SPA Navigation Detection

| ID | Requirement |
|---|---|
| FR-17 | The content script SHALL detect Netflix's single-page application navigation via `popstate` events and `<title>` element mutations. |
| FR-18 | URL changes SHALL be debounced by 400 ms to avoid redundant reloads on rapid navigation. |
| FR-19 | When navigating to a new title, the current layers SHALL be replaced with the preset for the new title (or cleared if none exists). |

### 3.7 Popup — Layer Management

| ID | Requirement |
|---|---|
| FR-20 | The popup SHALL display the Netflix title ID of the currently active tab, or "Not on a watch page" if not applicable. |
| FR-21 | The popup SHALL list all currently active layers for the current title, showing text content and timing badge where applicable. |
| FR-22 | The user SHALL be able to add a new text layer by submitting the add-layer form with: text, X, Y, font size, colour, and optional start/end times. |
| FR-23 | The user SHALL be able to add a chronometer layer via the **⏱ Add Chronometer** button, using the current X, Y, font size, and colour values from the form. |
| FR-24 | The user SHALL be able to remove any layer by clicking its ✕ button. |
| FR-25 | Adding or removing a layer SHALL immediately push the updated layer list to the content script (live preview). |

### 3.8 Popup — Preset Saving

| ID | Requirement |
|---|---|
| FR-26 | The user SHALL be able to persist the current layer configuration as a preset for the active title via the **💾 Save preset** button. |
| FR-27 | The Save preset button SHALL be disabled when the user is not on a Netflix watch page. |
| FR-28 | On successful save, the button SHALL show a **✓ Saved!** confirmation for 1.5 seconds before reverting to its default label. |

### 3.9 Visibility Toggle

| ID | Requirement |
|---|---|
| FR-29 | The user SHALL be able to show or hide all overlay layers at once via the **👁** toggle button in the popup header. |
| FR-30 | Toggling visibility SHALL NOT delete or modify stored layer data. |

### 3.10 Message Routing

| ID | Requirement |
|---|---|
| FR-31 | The service worker SHALL relay messages from the popup to the active tab's content script for `UPDATE_LAYERS` and `TOGGLE_VISIBILITY` message types. |
| FR-32 | The content script SHALL respond to `GET_TITLE_ID` requests from the popup with the current title ID. |
| FR-33 | When the content script detects a title change via SPA navigation, it SHALL broadcast a `TITLE_CHANGED` message so any open popup can refresh its layer list. |

---

## 4. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | The extension SHALL comply with Chrome Manifest V3 requirements (service worker, no remote code execution). |
| NFR-02 | Overlay rendering SHALL not degrade Netflix playback performance (no synchronous DOM operations inside the tick loop beyond a string comparison gate). |
| NFR-03 | The extension SHALL be load-compatible with Firefox via the `about:debugging` temporary add-on loader (Manifest V3). |

---

## 5. Default Presets (Dark — Netflix)

| Title ID | Episode | Layers |
|---|---|---|
| `80100172` | Dark (show page) | 1 static layer |
| `80114790` | Dark S1E1 (`/watch/80114790`) | Newton quote (11s–17s), Aristóteles quote (11s–17s), Porta de ferro description (28s–32s) |

---

## 6. Out of Scope

- Draggable/resizable layers via mouse interaction
- Multiple named presets per title
- Real-time synchronisation across devices via WebSocket
- Firefox Manifest V2 compatibility shim
- Support for streaming platforms other than Netflix
