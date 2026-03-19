const PRESETS_KEY = 'nto_presets';

// chrome.storage.sync total quota: 102,400 bytes; warn at 80%
const QUOTA_WARN_BYTES = 81920;

let layers = [];
let currentTitleId = null;
let editingIndex = null;
let dragIndex = null;

// --- Pure helper ---
// NOTE: formatTime is intentionally duplicated from src/lib/overlay-utils.js.
// popup.js runs as a browser script with no bundler — it cannot import from src/lib/.
// Both implementations must stay in sync.
function formatTime(seconds) {
  const s = Math.floor(seconds);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Storage helpers ---

function getPresets(cb) {
  chrome.storage.sync.get(PRESETS_KEY, (result) => cb(result[PRESETS_KEY] ?? {}));
}

function savePreset(titleId, titleLayers, cb) {
  getPresets((presets) => {
    presets[titleId] = titleLayers;
    const payload = { [PRESETS_KEY]: presets };
    const byteSize = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (byteSize > QUOTA_WARN_BYTES) {
      const warn = document.getElementById('quota-warning');
      if (warn) warn.style.display = '';
    }
    chrome.storage.sync.set(payload, cb);
  });
}

// --- Push current layers to content script (no storage write) ---

function pushLayers() {
  chrome.runtime.sendMessage({ target: 'content', type: 'UPDATE_LAYERS', layers });
}

// --- UI helpers ---

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

function buildTimingBadge(layer) {
  if (layer.type === 'chronometer') return '<span class="layer-timing">⏱ chrono</span>';
  if (layer.startTime == null && layer.endTime == null) return '';
  const start = layer.startTime != null ? formatTime(layer.startTime) : '00:00';
  const end = layer.endTime != null ? formatTime(layer.endTime) : '∞';
  return `<span class="layer-timing">${start} → ${end}</span>`;
}

function buildEditForm(layer) {
  const isChrono = layer.type === 'chronometer';
  return `
    ${!isChrono
      ? `<div class="edit-row"><textarea class="edit-text" rows="2">${escHtml(layer.text ?? '')}</textarea></div>`
      : '<div class="edit-row"><em class="chrono-label">⏱ Chronometer</em></div>'}
    <div class="edit-row row">
      <label>X <input type="number" class="edit-x" value="${layer.x ?? 20}" min="0"/></label>
      <label>Y <input type="number" class="edit-y" value="${layer.y ?? 20}" min="0"/></label>
      <label>Size <input type="number" class="edit-size" value="${layer.fontSize ?? 24}" min="8" max="120"/></label>
      <label>Color <input type="color" class="edit-color" value="${layer.color ?? '#ffffff'}"/></label>
    </div>
    ${!isChrono ? `<div class="edit-row row">
      <label>Start <input type="number" class="edit-start" value="${layer.startTime ?? ''}" placeholder="always" min="0"/></label>
      <label>End <input type="number" class="edit-end" value="${layer.endTime ?? ''}" placeholder="forever" min="0"/></label>
    </div>` : ''}
    <div class="edit-actions">
      <button class="btn-edit-save">✓ Save</button>
      <button class="btn-edit-cancel">Cancel</button>
    </div>
  `;
}

// --- Render layer list ---

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
    item.dataset.dragIndex = i;

    if (editingIndex === i) {
      item.classList.add('editing');
      item.innerHTML = buildEditForm(layer);
    } else {
      item.setAttribute('draggable', 'true');
      const displayText = layer.type === 'chronometer'
        ? '⏱ 00:00 → MM:SS'
        : escHtml(layer.text ?? '');
      item.innerHTML = `
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="layer-text">${displayText}</span>
        ${buildTimingBadge(layer)}
        <button class="btn-edit" data-index="${i}" title="Edit layer">✎</button>
        <button class="btn-remove" data-index="${i}" title="Remove layer">✕</button>
      `;
    }

    list.appendChild(item);
  });
}

// --- Layer position preview (M2.3) ---

const PREVIEW_SCALE = 160 / 1920;

function updatePreview() {
  const dot = document.getElementById('preview-dot');
  if (!dot) return;
  const x = Number(document.getElementById('input-x').value || 0);
  const y = Number(document.getElementById('input-y').value || 0);
  const color = document.getElementById('input-color').value || '#ffffff';
  const text = document.getElementById('input-text').value || '…';
  dot.style.left = Math.round(x * PREVIEW_SCALE) + 'px';
  dot.style.top = Math.round(y * PREVIEW_SCALE) + 'px';
  dot.style.color = color;
  dot.textContent = text.slice(0, 30);
}

['input-text', 'input-x', 'input-y', 'input-size', 'input-color'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updatePreview);
});
updatePreview();

// --- Video time polling (M2.6) ---

function pollVideoTime() {
  if (!currentTitleId) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(
      tabs[0].id,
      { target: 'content', type: 'GET_VIDEO_TIME' },
      (response) => {
        if (chrome.runtime.lastError) return;
        const el = document.getElementById('video-time');
        if (!el) return;
        el.textContent = response?.currentTime != null
          ? '▶ ' + formatTime(response.currentTime)
          : '';
      },
    );
  });
}

setInterval(pollVideoTime, 1000);

// --- Event delegation on layer list ---

const layerList = document.getElementById('layer-list');

// Drag-to-reorder (M2.1)
layerList.addEventListener('dragstart', (e) => {
  const item = e.target.closest('[data-drag-index]');
  if (!item) return;
  dragIndex = Number(item.dataset.dragIndex);
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

layerList.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const item = e.target.closest('[data-drag-index]');
  if (!item) return;
  layerList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (Number(item.dataset.dragIndex) !== dragIndex) item.classList.add('drag-over');
});

layerList.addEventListener('dragleave', (e) => {
  if (!layerList.contains(e.relatedTarget)) {
    layerList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  }
});

layerList.addEventListener('drop', (e) => {
  e.preventDefault();
  const item = e.target.closest('[data-drag-index]');
  if (!item || dragIndex === null) return;
  const dropIdx = Number(item.dataset.dragIndex);
  if (dragIndex !== dropIdx) {
    const [moved] = layers.splice(dragIndex, 1);
    layers.splice(dropIdx, 0, moved);
    pushLayers();
  }
  dragIndex = null;
  renderList();
});

layerList.addEventListener('dragend', () => {
  dragIndex = null;
  layerList.querySelectorAll('.dragging, .drag-over').forEach((el) => {
    el.classList.remove('dragging', 'drag-over');
  });
});

// Clicks: remove / edit / save / cancel (M2.2)
layerList.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.btn-remove');
  if (removeBtn) {
    const idx = Number(removeBtn.dataset.index);
    layers.splice(idx, 1);
    if (editingIndex === idx) editingIndex = null;
    else if (editingIndex !== null && editingIndex > idx) editingIndex--;
    pushLayers();
    renderList();
    return;
  }

  const editBtn = e.target.closest('.btn-edit');
  if (editBtn) {
    editingIndex = Number(editBtn.dataset.index);
    renderList();
    return;
  }

  const saveBtn = e.target.closest('.btn-edit-save');
  if (saveBtn) {
    const item = saveBtn.closest('.layer-item');
    const layer = layers[editingIndex];
    if (layer) {
      layer.x = Number(item.querySelector('.edit-x')?.value ?? layer.x);
      layer.y = Number(item.querySelector('.edit-y')?.value ?? layer.y);
      layer.fontSize = Number(item.querySelector('.edit-size')?.value ?? layer.fontSize);
      layer.color = item.querySelector('.edit-color')?.value ?? layer.color;
      if (layer.type !== 'chronometer') {
        layer.text = (item.querySelector('.edit-text')?.value ?? '').trim() || layer.text;
        const startVal = item.querySelector('.edit-start')?.value;
        const endVal = item.querySelector('.edit-end')?.value;
        if (startVal !== '') layer.startTime = Number(startVal);
        else delete layer.startTime;
        if (endVal !== '') layer.endTime = Number(endVal);
        else delete layer.endTime;
      }
    }
    editingIndex = null;
    pushLayers();
    renderList();
    return;
  }

  if (e.target.closest('.btn-edit-cancel')) {
    editingIndex = null;
    renderList();
  }
});

// --- Init ---

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

// --- Listen for SPA navigation ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TITLE_CHANGED') {
    currentTitleId = message.titleId;
    setTitleBar(currentTitleId);
    editingIndex = null;
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
  updatePreview();
});

// --- Save preset ---

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
