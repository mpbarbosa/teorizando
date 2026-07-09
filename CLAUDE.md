# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo (`teorizando`) began as a personal notes/knowledge base, but the substantive active project is the **`dark-text-overlay/`** Chrome extension. Nearly all engineering work happens there.

- `dark-text-overlay/` — Manifest V3 browser extension (the real codebase; see below)
- `documentation/`, root `*.md` files — legacy exploratory tech notes (English content, Portuguese naming). The root `README.md` is a stub.
- `.github/copilot-instructions.md` describes only the legacy notes-repo purpose and predates the extension — treat it as outdated for anything code-related.

**All commands below must be run from inside `dark-text-overlay/`** (that's the npm package root, and CI sets it as the working directory).

## Commands

```bash
npm test                        # Jest — all tests
npx jest tests/service-worker.test.js   # single test file
npx jest -t "formats seconds"           # single test by name
npm run test:coverage           # Jest with coverage
npm run lint                    # ESLint (src/**/*.js)
```

There is **no build step** — source files are shipped as-is and loaded via `chrome://extensions` → *Load unpacked*. CI (`.github/workflows/dark-text-overlay-ci.yml`) runs `npm run lint` then `npm test` on any change under `dark-text-overlay/**`.

## Architecture

A Manifest V3 extension that injects time-synchronized text/graphic overlays onto Netflix watch pages. Three execution contexts communicate by message passing:

- **Content script** (`src/content/overlay.js`) — the engine. An IIFE that attaches a **closed Shadow DOM** host (`z-index: 2147483647`, `pointer-events: none`) over the Netflix player, isolating overlay styles from Netflix CSS. It detects Netflix's SPA navigation (title `<title>` MutationObserver + `popstate`, debounced), resolves the title ID, loads its preset, and runs a **500ms tick loop** that diffs the visible-layer set (via `layerKey`) against `video.currentTime` and re-renders only on change. Also builds SVG shapes, parses rich text (markdown → sanitized HTML), and implements drag mode.
- **Popup** (`src/popup/popup.js`, ~1000 LOC) — the entire editor UI: preset library, inline edit forms, drag-reorder, timeline, live preview, import/export, quota guard. Runs as a plain browser script (no modules/bundler).
- **Service worker** (`src/background/service-worker.js`) — thin message router (popup → active tab's content script), the `Alt+Shift+O` keyboard command, and preset seeding/migration on install/update.
- **Pure utils** (`src/lib/overlay-utils.js`) — `formatTime`, `getTitleIdFromUrl`, `getVisibleLayers`, `layerKey`. The only DOM/chrome-free module, and the primary unit-test surface.

### Data & storage model

State lives in `chrome.storage.local` under two keys:
- `nto_presets` — `{ titleId: { presetName: { layers, created, modified } } }` (named presets per Netflix title ID)
- `nto_active` — `{ titleId: presetName }` (which preset is active per title)

A **layer** is a JSON object with a `type` (text / `chronometer` / `shape` / `image`), position, style, optional `startTime`/`endTime` display window, optional `richText`, and optional `group`. `src/default-presets.json` seeds presets on first install. There is a **legacy format migration**: old flat-array presets (`{ titleId: [layers] }`) are converted to the named-preset shape — this logic exists in *both* the service worker (on update) and `popup.js` (`migratePresets`), so keep them consistent.

Title resolution has a fallback chain: URL pathname (`/watch/<id>` or `/title/<id>`) → if no preset, resolve the parent show ID from the page DOM (JSON-LD `partOfSeries` or `/title/` anchors) and try that.

## Constraints to respect

- **No bundler / no imports across contexts.** `formatTime` is intentionally duplicated in `overlay-utils.js`, an inline fallback in `overlay.js`, and `popup.js`; `getVisibleLayers`/`layerKey` are likewise inlined into `overlay.js`. Changing one copy means changing the others.
- **Overlay must stay non-interactive** except in drag mode — `pointer-events` toggles on the host, and the overlay must never block clicks to the Netflix player otherwise.
- **`chrome.storage.local` is quota-limited** (~5 MB total). Presets were moved off `chrome.storage.sync` (8 KB-per-key cap) to fit large per-episode presets; the trade-off is no cross-device sync. The popup warns near the limit; be wary of storing large image data URLs in `layer.src`.
- **Test coverage is concentrated on pure utils and message routing.** The DOM-heavy `overlay.js` and `popup.js` are largely untested. Draft tests live in `test/` (singular) but are **not run** — Jest only matches `tests/` (plural), and the drafts are blocked on a module refactor (see `test/README.md`). Add runnable tests under `tests/`.

## Workflow tooling

`dark-text-overlay/.workflow-config.yaml` and `.ai_workflow/` configure an external `ai_workflow.js` automation (personas for code review, testing, docs, etc.). This runs outside Claude Code; the config records the canonical `test`/`lint` commands and project metadata.
