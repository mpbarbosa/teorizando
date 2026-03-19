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

// Seed default presets on first install (won't overwrite user data on updates)
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return;

  fetch(chrome.runtime.getURL('src/default-presets.json'))
    .then((r) => r.json())
    .then((defaults) => {
      chrome.storage.sync.get('nto_presets', (result) => {
        const existing = result['nto_presets'] ?? {};
        // Only seed title IDs that the user hasn't already configured
        const merged = { ...defaults, ...existing };
        chrome.storage.sync.set({ nto_presets: merged });
      });
    })
    .catch((err) => console.warn('[NTO] Failed to seed default presets:', err));
});
