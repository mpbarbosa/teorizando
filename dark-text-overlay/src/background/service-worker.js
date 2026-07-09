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

// Merges the bundled default presets into storage (existing titles win, so a
// user's own presets are never overwritten).
function seedDefaultPresets() {
  fetch(chrome.runtime.getURL('src/default-presets.json'))
    .then((r) => r.json())
    .then((defaults) => {
      chrome.storage.sync.get('nto_presets', (result) => {
        const existing = result['nto_presets'] ?? {};
        const merged = { ...defaults, ...existing };
        chrome.storage.sync.set({ nto_presets: merged });
      });
    })
    .catch((err) => console.warn('[NTO] Failed to seed default presets:', err));
}

// Seed default presets and keep the storage format current.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    seedDefaultPresets();
    return;
  }

  if (reason !== 'update') return;

  chrome.storage.sync.get('nto_presets', (result) => {
    const { presets, didMigrate } = ntoUtils.migratePresets(result['nto_presets'] ?? {});
    if (didMigrate) chrome.storage.sync.set({ nto_presets: presets });
    // Self-heal: if storage is empty (e.g. a broken earlier install never
    // seeded — and reloads only ever fire 'update'), seed defaults now so the
    // overlay isn't left with nothing to show.
    if (Object.keys(presets).length === 0) seedDefaultPresets();
  });
});
