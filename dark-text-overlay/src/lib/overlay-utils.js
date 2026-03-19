/**
 * Pure utility functions shared between overlay.js and tests.
 * These have no dependency on the DOM or chrome.* APIs.
 */

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

if (typeof module !== 'undefined') {
  module.exports = { formatTime, getTitleIdFromUrl, getVisibleLayers, layerKey };
}
