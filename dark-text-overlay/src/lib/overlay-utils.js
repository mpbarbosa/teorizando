/**
 * Pure utility functions shared between overlay.js, popup.js, the service
 * worker, and tests. No dependency on the DOM or chrome.* APIs.
 *
 * Wrapped in an IIFE on purpose: this file is loaded as a plain (non-module)
 * script into shared global scopes — the content-script isolated world, the
 * popup page, and the service worker (via importScripts). Declaring the helpers
 * at top level would leak them as globals, and each consumer's
 * `const { … } = __ntoUtils` would then collide ("Identifier already declared").
 * Keeping everything inside the IIFE means only `__ntoUtils` is exposed.
 */
(function () {
/**
 * Formats a video time in seconds to MM:SS display string.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const s = Math.floor(seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Extracts a Netflix title ID from a URL pathname.
 * Matches /watch/<id> and /title/<id>.
 * @param {string} pathname
 * @returns {string|null}
 */
function getTitleIdFromUrl(pathname) {
  const m = pathname.match(/\/(?:watch|title)\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Filters layers to those visible at the given video time.
 * Layers without startTime/endTime are always visible.
 * @param {Array} layers
 * @param {number|null} currentTime
 * @returns {Array}
 */
function getVisibleLayers(layers, currentTime) {
  return layers.filter((layer) => {
    if (layer.startTime == null && layer.endTime == null) return true;
    if (currentTime == null) return false;
    const afterStart = layer.startTime == null || currentTime >= layer.startTime;
    const beforeEnd = layer.endTime == null || currentTime <= layer.endTime;
    return afterStart && beforeEnd;
  });
}

/**
 * Returns a stable string key for a layer at a given video time.
 * Used to detect when the visible set changes between ticks.
 * @param {Object} layer
 * @param {number|null} currentTime
 * @returns {string}
 */
function layerKey(layer, currentTime) {
  if (layer.type === 'chronometer') return `chrono-${Math.floor(currentTime ?? 0)}`;
  return `${layer.startTime ?? ''}-${layer.endTime ?? ''}-${layer.text}`;
}

/**
 * Upgrades the legacy flat-array preset format to the named-preset format.
 * Old: { titleId: [layers] }  →  New: { titleId: { Default: { layers, created, modified } } }
 * Mutates `presets` in place; already-named titles are left untouched.
 * @param {Object} presets
 * @returns {{ presets: Object, didMigrate: boolean }}
 */
function migratePresets(presets) {
  let didMigrate = false;
  for (const [titleId, value] of Object.entries(presets)) {
    if (Array.isArray(value)) {
      presets[titleId] = {
        Default: { layers: value, created: Date.now(), modified: Date.now() },
      };
      didMigrate = true;
    }
  }
  return { presets, didMigrate };
}

const api = { formatTime, getTitleIdFromUrl, getVisibleLayers, layerKey, migratePresets };

// Expose to browser contexts: content script, popup page, and the
// service worker (loaded there via importScripts).
if (typeof globalThis !== 'undefined') {
  globalThis.__ntoUtils = api;
}
// Expose to CommonJS consumers (Jest / Node).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
})();
