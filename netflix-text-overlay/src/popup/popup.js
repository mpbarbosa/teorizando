const PRESETS_KEY = 'nto_presets';

let layers = [];
let currentTitleId = null;

// --- Storage helpers ---

function getPresets(cb) {
  chrome.storage.sync.get(PRESETS_KEY, (result) => cb(result[PRESETS_KEY] ?? {}));
}

function savePreset(titleId, titleLayers, cb) {
  getPresets((presets) => {
    presets[titleId] = titleLayers;
    chrome.storage.sync.set({ [PRESETS_KEY]: presets }, cb);
  });
}

// --- Push current layers to content script (no storage write) ---
function pushLayers() {
  chrome.runtime.sendMessage({ target: 'content', type: 'UPDATE_LAYERS', layers });
}

// --- UI ---

function setTitleBar(titleId) {
  const label = document.getElementById('title-label');
  const btn = document.getElementById('btn-save-preset');
  if (titleId) {
    label.textContent = `Title ID: ${titleId}`;
    label.title = `netflix.com/watch/${titleId}`;
    btn.disabled = false;
  } else {
    label.textContent = 'Not on a watch page';
    label.title = '';
    btn.disabled = true;
  }
}

function renderList() {
  const list = document.getElementById('layer-list');
  list.innerHTML = '';

  if (layers.length === 0) {
    list.innerHTML = '<p class="empty-msg">No layers yet.</p>';
    return;
  }

  layers.forEach((layer, i) => {
    const item = document.createElement('div');
    item.className = 'layer-item';
    const timingLabel = layer.type === 'chronometer'
      ? '<span class="layer-timing">⏱ chrono</span>'
      : (layer.startTime != null || layer.endTime != null
        ? `<span class="layer-timing">${layer.startTime ?? 0}s–${layer.endTime != null ? layer.endTime + 's' : '∞'}</span>`
        : '');
    const displayText = layer.type === 'chronometer' ? '00:00 → MM:SS' : layer.text;
    item.innerHTML = `
      <span class="layer-text">${displayText}</span>
      ${timingLabel}
      <button class="btn-remove" data-index="${i}" title="Remove">✕</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      layers.splice(Number(btn.dataset.index), 1);
      pushLayers();
      renderList();
    });
  });
}

// --- Init: get title ID from content script, then load its preset ---

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0]?.id;
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { target: 'content', type: 'GET_TITLE_ID' }, (response) => {
    currentTitleId = response?.titleId ?? null;
    setTitleBar(currentTitleId);

    if (currentTitleId) {
      getPresets((presets) => {
        layers = presets[currentTitleId] ?? [];
        renderList();
        pushLayers();
      });
    } else {
      renderList();
    }
  });
});

// --- Listen for SPA navigation from content script ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TITLE_CHANGED') {
    currentTitleId = message.titleId;
    setTitleBar(currentTitleId);

    if (currentTitleId) {
      getPresets((presets) => {
        layers = presets[currentTitleId] ?? [];
        renderList();
      });
    } else {
      layers = [];
      renderList();
    }
  }
});

// --- Add new layer ---
document.getElementById('form-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = document.getElementById('input-text').value.trim();
  if (!text) return;

  layers.push({
    text,
    x: Number(document.getElementById('input-x').value),
    y: Number(document.getElementById('input-y').value),
    fontSize: Number(document.getElementById('input-size').value),
    color: document.getElementById('input-color').value,
    ...(document.getElementById('input-start').value !== '' && {
      startTime: Number(document.getElementById('input-start').value),
    }),
    ...(document.getElementById('input-end').value !== '' && {
      endTime: Number(document.getElementById('input-end').value),
    }),
  });

  pushLayers();
  renderList();
  document.getElementById('input-text').value = '';
});

// --- Save preset for current title ---
document.getElementById('btn-save-preset').addEventListener('click', () => {
  if (!currentTitleId) return;
  const btn = document.getElementById('btn-save-preset');
  savePreset(currentTitleId, layers, () => {
    btn.textContent = '✓ Saved!';
    setTimeout(() => (btn.textContent = '💾 Save preset'), 1500);
  });
});

// --- Toggle overlay visibility ---
document.getElementById('btn-toggle').addEventListener('click', () => {
  chrome.runtime.sendMessage({ target: 'content', type: 'TOGGLE_VISIBILITY' });
});

// --- Add chronometer layer ---
document.getElementById('btn-add-chrono').addEventListener('click', () => {
  layers.push({
    type: 'chronometer',
    x: Number(document.getElementById('input-x').value),
    y: Number(document.getElementById('input-y').value),
    fontSize: Number(document.getElementById('input-size').value),
    color: document.getElementById('input-color').value,
  });
  pushLayers();
  renderList();
});
