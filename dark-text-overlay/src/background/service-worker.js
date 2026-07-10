// Shared pure utilities. In the Chrome service-worker runtime they are pulled in
// with importScripts (overlay-utils.js is an IIFE that sets self.__ntoUtils);
// under Jest/Node the same file is a CommonJS module.
let ntoUtils;
if (typeof importScripts === 'function') {
  importScripts('/src/lib/overlay-utils.js');
  ntoUtils = self.__ntoUtils;
} else {
  ntoUtils = require('../lib/overlay-utils.js');
}

// Listens for messages from the popup and forwards them to the active tab's content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message, sendResponse);
      }
    });
    return true; // keep channel open for async sendResponse
  }
});

// Toggle overlay via keyboard shortcut (Alt+Shift+O)
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-overlay') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { target: 'content', type: 'TOGGLE_VISIBILITY' });
    }
  });
});

// Merges the bundled default presets into storage. Additive and non-destructive:
// legacy flat-array formats are upgraded to named presets, any bundled preset
// the user is missing is added (so new default presets reach existing installs),
// and every preset the user already has is left untouched — their edits win, at
// the individual-preset level. Trade-off: a default preset the user deleted will
// reappear on the next seed, since "deleted" and "never had" look identical.
function seedDefaultPresets() {
  fetch(chrome.runtime.getURL('src/default-presets.json'))
    .then((r) => r.json())
    .then((defaults) => {
      chrome.storage.local.get('nto_presets', (result) => {
        const { presets: def } = ntoUtils.migratePresets(defaults);
        const { presets: existing } = ntoUtils.migratePresets(result['nto_presets'] ?? {});
        const merged = { ...existing };
        for (const titleId of Object.keys(def)) {
          // Per-preset merge: bundled presets first, existing ones overwrite them.
          merged[titleId] = { ...def[titleId], ...(existing[titleId] ?? {}) };
        }
        chrome.storage.local.set({ nto_presets: merged });
      });
    })
    .catch((err) => console.warn('[NTO] Failed to seed default presets:', err));
}

// Run the additive merge on install and on update, so newly-bundled presets
// flow to existing installs (and legacy formats get upgraded) without a reseed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') seedDefaultPresets();
});
