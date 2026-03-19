const PRESETS_KEY = 'nto_presets';
const ACTIVE_KEY = 'nto_active';

// chrome.storage.sync total quota: 102,400 bytes; warn at 80%
const QUOTA_WARN_BYTES = 81920;

let layers = [];
let currentTitleId = null;
let currentPresetName = null;
let editingIndex = null;
let dragIndex = null;
let libraryOpen = false;
let dragModeActive = false;
let groupVisibility = {}; // { groupName: bool } — false = hidden

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

// --- Migration: old flat-array format → named presets ---

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

// --- Storage helpers ---

function getPresets(cb) {
  chrome.storage.sync.get(PRESETS_KEY, (result) => {
    const raw = result[PRESETS_KEY] ?? {};
    const { presets, didMigrate } = migratePresets(raw);
    if (didMigrate) chrome.storage.sync.set({ [PRESETS_KEY]: presets });
    cb(presets);
  });
}

function getActivePresetName(titleId, cb) {
  chrome.storage.sync.get(ACTIVE_KEY, (result) => {
    cb((result[ACTIVE_KEY] ?? {})[titleId] ?? null);
  });
}

function setActivePresetName(titleId, presetName, cb) {
  chrome.storage.sync.get(ACTIVE_KEY, (result) => {
    const active = result[ACTIVE_KEY] ?? {};
    active[titleId] = presetName;
    chrome.storage.sync.set({ [ACTIVE_KEY]: active }, cb);
  });
}

function saveNamedPreset(titleId, presetName, titleLayers, cb) {
  getPresets((presets) => {
    if (!presets[titleId]) presets[titleId] = {};
    const existing = presets[titleId][presetName];
    presets[titleId][presetName] = {
      layers: titleLayers,
      created: existing?.created ?? Date.now(),
      modified: Date.now(),
    };
    const payload = { [PRESETS_KEY]: presets };
    const byteSize = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (byteSize > QUOTA_WARN_BYTES) {
      const warn = document.getElementById('quota-warning');
      if (warn) warn.style.display = '';
    }
    chrome.storage.sync.set(payload, cb);
  });
}

function deleteNamedPreset(titleId, presetName, cb) {
  getPresets((presets) => {
    if (presets[titleId]) {
      delete presets[titleId][presetName];
      if (Object.keys(presets[titleId]).length === 0) delete presets[titleId];
    }
    chrome.storage.sync.set({ [PRESETS_KEY]: presets }, cb);
  });
}

function renameNamedPreset(titleId, oldName, newName, cb) {
  getPresets((presets) => {
    if (!presets[titleId]?.[oldName]) return cb?.();
    presets[titleId][newName] = presets[titleId][oldName];
    delete presets[titleId][oldName];
    chrome.storage.sync.set({ [PRESETS_KEY]: presets }, () => {
      chrome.storage.sync.get(ACTIVE_KEY, (result) => {
        const active = result[ACTIVE_KEY] ?? {};
        if (active[titleId] === oldName) {
          active[titleId] = newName;
          chrome.storage.sync.set({ [ACTIVE_KEY]: active }, cb);
        } else {
          cb?.();
        }
      });
    });
  });
}

// --- Push current layers to content script (no storage write) ---

function getEffectiveLayers() {
  if (Object.keys(groupVisibility).length === 0) return layers;
  return layers.filter((l) => !l.group || groupVisibility[l.group] !== false);
}

function pushLayers() {
  chrome.runtime.sendMessage({ target: 'content', type: 'UPDATE_LAYERS', layers: getEffectiveLayers() });
}

// --- Export / Import / Factory defaults ---

function exportPresetToFile(titleId, presetName, presetData) {
  const json = JSON.stringify(
    { version: '1', exported: new Date().toISOString(), titleId, presetName, layers: presetData.layers },
    null, 2,
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nto-${titleId}-${presetName.replace(/\W+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPresetFromFile(file, titleId, cb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.version !== '1' || !Array.isArray(data.layers)) throw new Error('Invalid preset file format');
      const baseName = data.presetName || 'Imported';
      getPresets((presets) => {
        const existing = Object.keys(presets[titleId] ?? {});
        let finalName = baseName;
        let n = 1;
        while (existing.includes(finalName)) finalName = `${baseName} (${n++})`;
        saveNamedPreset(titleId, finalName, data.layers, () => cb(null, finalName));
      });
    } catch (err) {
      cb(err);
    }
  };
  reader.readAsText(file);
}

function loadFactoryDefault(titleId, cb) {
  fetch(chrome.runtime.getURL('src/default-presets.json'))
    .then((r) => r.json())
    .then((defaults) => {
      const titleData = defaults[titleId];
      if (!titleData) { cb(new Error('No factory default for this title')); return; }
      // Support both old flat-array and new named-preset format
      const rawLayers = Array.isArray(titleData)
        ? titleData
        : (titleData.Default?.layers ?? titleData[Object.keys(titleData)[0]]?.layers ?? []);
      cb(null, rawLayers);
    })
    .catch(cb);
}

// --- UI helpers ---

function setTitleBar(titleId) {
  const label = document.getElementById('title-label');
  if (titleId) {
    label.textContent = `Title ID: ${titleId}`;
    label.title = `netflix.com/watch/${titleId}`;
  } else {
    label.textContent = 'Not on a watch page';
    label.title = '';
  }
}

// --- Render preset selector bar (M3) ---

function renderPresetBar(titleId, presets) {
  const bar = document.getElementById('preset-bar');
  const saveBtn = document.getElementById('btn-save-preset');
  if (!titleId) {
    bar.style.display = 'none';
    if (saveBtn) saveBtn.disabled = true;
    return;
  }
  bar.style.display = '';
  if (saveBtn) saveBtn.disabled = false;
  const select = document.getElementById('preset-select');
  const names = Object.keys(presets[titleId] ?? {});
  select.innerHTML = '';
  if (names.length === 0) {
    select.innerHTML = '<option value="">— no presets —</option>';
  } else {
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentPresetName) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

// --- Render preset library panel (M3) ---

function renderPresetLibrary(titleId, presets) {
  const list = document.getElementById('preset-list');
  if (!list) return;
  const titlePresets = presets[titleId] ?? {};
  const names = Object.keys(titlePresets);
  list.innerHTML = '';
  if (names.length === 0) {
    list.innerHTML = '<li class="empty-msg" style="padding:8px 10px">No saved presets.</li>';
    return;
  }
  names.forEach((name) => {
    const li = document.createElement('li');
    li.className = 'preset-item' + (name === currentPresetName ? ' active' : '');
    li.dataset.preset = name;
    li.innerHTML = `
      <span class="preset-name">${escHtml(name)}</span>
      <span class="preset-meta">${titlePresets[name].layers?.length ?? 0} layers</span>
      <div class="preset-actions">
        <button class="btn-preset-activate" title="Activate">✓</button>
        <button class="btn-preset-export" title="Export to JSON">⬇</button>
        <button class="btn-preset-rename" title="Rename">✎</button>
        <button class="btn-preset-delete" title="Delete">✕</button>
      </div>
    `;
    list.appendChild(li);
  });
}


function buildTimingBadge(layer) {
  if (layer.type === 'chronometer') return '<span class="layer-timing">⏱ chrono</span>';
  if (layer.startTime == null && layer.endTime == null) return '';
  const start = layer.startTime != null ? formatTime(layer.startTime) : '00:00';
  const end = layer.endTime != null ? formatTime(layer.endTime) : '∞';
  return `<span class="layer-timing">${start} → ${end}</span>`;
}

function layerTypeIcon(layer) {
  if (layer.type === 'chronometer') return '⏱';
  if (layer.type === 'shape') return { rect: '⬜', circle: '⭕', ellipse: '⬭', line: '─', arrow: '→', polygon: '△' }[layer.shape ?? 'rect'] ?? '⬜';
  if (layer.type === 'image') return '🖼';
  return '𝑇';
}

function layerDisplayText(layer) {
  if (layer.type === 'chronometer') return '00:00 → MM:SS';
  if (layer.type === 'shape') return `${layer.shape ?? 'rect'} ${layer.width ?? 100}×${layer.height ?? 60}${layer.label?.text ? ' "' + layer.label.text + '"' : ''}`;
  if (layer.type === 'image') return layer.src ? layer.src.slice(0, 40) : '(no src)';
  return escHtml(layer.text ?? '');
}

function buildEditForm(layer) {
  const isShape  = layer.type === 'shape';
  const isImage  = layer.type === 'image';
  const isChrono = layer.type === 'chronometer';
  const isText   = !isShape && !isImage && !isChrono;
  return `
    ${isText   ? `<div class="edit-row"><textarea class="edit-text" rows="2">${escHtml(layer.text ?? '')}</textarea></div>
                  <div class="edit-row"><label class="checkbox-label"><input type="checkbox" class="edit-richtext"${layer.richText ? ' checked' : ''}> Rich text</label></div>` : ''}
    ${isChrono ? '<div class="edit-row"><em class="chrono-label">⏱ Chronometer</em></div>' : ''}
    ${isShape  ? `<div class="edit-row row">
      <label>Shape <select class="edit-shape">
        <option value="rect"${layer.shape==='rect'?' selected':''}>Rect</option>
        <option value="circle"${layer.shape==='circle'?' selected':''}>Circle</option>
        <option value="ellipse"${layer.shape==='ellipse'?' selected':''}>Ellipse</option>
        <option value="line"${layer.shape==='line'?' selected':''}>Line</option>
        <option value="arrow"${layer.shape==='arrow'?' selected':''}>Arrow</option>
        <option value="polygon"${layer.shape==='polygon'?' selected':''}>Triangle</option>
      </select></label>
      <label>W <input type="number" class="edit-shape-w" value="${layer.width ?? 120}" min="4"/></label>
      <label>H <input type="number" class="edit-shape-h" value="${layer.height ?? 70}" min="4"/></label>
    </div>
    <div class="edit-row row">
      <label>Fill <input type="color" class="edit-fill" value="${layer.fill ?? '#000000'}"/></label>
      <label>Stroke <input type="color" class="edit-stroke" value="${layer.stroke ?? '#ffffff'}"/></label>
      <label>SW <input type="number" class="edit-sw" value="${layer.strokeWidth ?? 2}" min="0" max="30"/></label>
      <label>α <input type="number" class="edit-opacity" value="${layer.opacity ?? 1}" min="0" max="1" step="0.1"/></label>
    </div>
    <div class="edit-row">
      <input type="text" class="edit-label" value="${escHtml(layer.label?.text ?? '')}" placeholder="Label text"/>
    </div>` : ''}
    ${isImage  ? `<div class="edit-row"><input type="text" class="edit-src" value="${escHtml(layer.src ?? '')}" placeholder="Image URL"/></div>
    <div class="edit-row row">
      <label>W <input type="number" class="edit-img-w" value="${layer.width ?? 80}" min="4"/></label>
      <label>H <input type="number" class="edit-img-h" value="${layer.height ?? 80}" min="4"/></label>
      <label>α <input type="number" class="edit-img-opacity" value="${layer.opacity ?? 1}" min="0" max="1" step="0.1"/></label>
    </div>` : ''}
    <div class="edit-row row">
      <label>X <input type="number" class="edit-x" value="${layer.x ?? 20}" min="0"/></label>
      <label>Y <input type="number" class="edit-y" value="${layer.y ?? 20}" min="0"/></label>
      ${isText || isChrono ? `<label>Size <input type="number" class="edit-size" value="${layer.fontSize ?? 24}" min="8" max="120"/></label>
      <label>Color <input type="color" class="edit-color" value="${layer.color ?? '#ffffff'}"/></label>` : ''}
    </div>
    <div class="edit-row"><label class="grow">Group <input type="text" class="edit-group" value="${escHtml(layer.group ?? '')}" placeholder="group name"/></label></div>
    ${!isChrono ? `<div class="edit-row row">
      <label>Start <input type="number" class="edit-start" value="${layer.startTime ?? ''}" placeholder="always" min="0"/></label>
      <label>End   <input type="number" class="edit-end"   value="${layer.endTime ?? ''}"   placeholder="forever" min="0"/></label>
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
    renderTimeline();
    renderGroups();
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
      const groupDimmed = layer.group && groupVisibility[layer.group] === false;
      if (groupDimmed) item.classList.add('group-hidden');
      item.innerHTML = `
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="layer-icon" title="${layer.type ?? 'text'}">${layerTypeIcon(layer)}</span>
        <span class="layer-text">${layerDisplayText(layer)}</span>
        ${layer.group ? `<span class="layer-group-badge">${escHtml(layer.group)}</span>` : ''}
        ${buildTimingBadge(layer)}
        <button class="btn-edit" data-index="${i}" title="Edit layer">✎</button>
        <button class="btn-remove" data-index="${i}" title="Remove layer">✕</button>
      `;
    }

    list.appendChild(item);
  });

  renderTimeline();
  renderGroups();
}

// --- Groups panel (M4.4) ---

function renderGroups() {
  const groups = [...new Set(layers.map((l) => l.group).filter(Boolean))];
  const btn = document.getElementById('btn-groups-toggle');
  if (btn) btn.style.display = groups.length > 0 ? '' : 'none';

  const container = document.getElementById('groups-list');
  if (!container) return;
  container.innerHTML = '';
  groups.forEach((name) => {
    const visible = groupVisibility[name] !== false;
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = `
      <span class="group-name">${escHtml(name)}</span>
      <button class="btn-group-toggle ${visible ? 'on' : 'off'}" data-group="${escHtml(name)}">${visible ? '👁 Show' : '🚫 Hide'}</button>
    `;
    container.appendChild(row);
  });
}

// --- Timeline (M4.5) ---

const TIMELINE_W = 290;
const TYPE_COLORS = { text: '#e50914', shape: '#4fc3f7', image: '#81c784', chronometer: '#ffb74d' };

function renderTimeline() {
  const canvas = document.getElementById('timeline-canvas');
  if (!canvas) return;
  canvas.innerHTML = '';

  const timed = layers.filter((l) => l.startTime != null || l.endTime != null);
  if (timed.length === 0) return;

  const maxT = Math.max(...timed.map((l) => l.endTime ?? l.startTime ?? 0)) + 5;
  const scale = TIMELINE_W / maxT;

  timed.forEach((layer, i) => {
    const start = (layer.startTime ?? 0) * scale;
    const end   = (layer.endTime   ?? maxT) * scale;
    const w     = Math.max(3, end - start);
    const color = TYPE_COLORS[layer.type ?? 'text'] ?? '#888';
    const row = document.createElement('div');
    row.className = 'timeline-row';
    row.title = `${layerDisplayText(layer)}  ${formatTime(layer.startTime ?? 0)} → ${layer.endTime != null ? formatTime(layer.endTime) : '∞'}`;
    const bar = document.createElement('div');
    bar.className = 'timeline-bar';
    bar.style.cssText = `left:${start}px;width:${w}px;background:${color};`;
    row.appendChild(bar);
    canvas.appendChild(row);
  });

  // Time ruler
  const ruler = document.createElement('div');
  ruler.className = 'timeline-ruler';
  const step = maxT > 120 ? 30 : maxT > 60 ? 15 : maxT > 30 ? 10 : 5;
  for (let t = 0; t <= maxT; t += step) {
    const tick = document.createElement('span');
    tick.className = 'timeline-tick';
    tick.style.left = (t * scale) + 'px';
    tick.textContent = formatTime(t);
    ruler.appendChild(tick);
  }
  canvas.appendChild(ruler);
}

// --- Layer position preview (M2.3) ---

const PREVIEW_SCALE = 160 / 1920;

function updatePreview() {
  const dot = document.getElementById('preview-dot');
  if (!dot) return;
  const x = Number(document.getElementById('input-x')?.value || 0);
  const y = Number(document.getElementById('input-y')?.value || 0);
  const type = document.getElementById('input-type')?.value ?? 'text';
  const color = type === 'text' ? (document.getElementById('input-color')?.value || '#ffffff') : '#4fc3f7';
  const label = type === 'text'
    ? (document.getElementById('input-text')?.value || '…')
    : type === 'shape' ? (document.getElementById('input-shape')?.value || '⬜') + ' ' + (document.getElementById('input-shape-w')?.value ?? '')
    : type === 'image' ? '🖼'
    : '…';
  dot.style.left = Math.round(x * PREVIEW_SCALE) + 'px';
  dot.style.top  = Math.round(y * PREVIEW_SCALE) + 'px';
  dot.style.color = color;
  dot.textContent = label.slice(0, 30);
}

['input-text', 'input-x', 'input-y', 'input-size', 'input-color', 'input-shape', 'input-shape-w', 'input-type'].forEach((id) => {
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
      const groupVal = item.querySelector('.edit-group')?.value.trim();
      if (groupVal != null) { if (groupVal) layer.group = groupVal; else delete layer.group; }

      if (layer.type === 'shape') {
        layer.shape       = item.querySelector('.edit-shape')?.value ?? layer.shape;
        layer.width       = Number(item.querySelector('.edit-shape-w')?.value ?? layer.width);
        layer.height      = Number(item.querySelector('.edit-shape-h')?.value ?? layer.height);
        layer.fill        = item.querySelector('.edit-fill')?.value ?? layer.fill;
        layer.stroke      = item.querySelector('.edit-stroke')?.value ?? layer.stroke;
        layer.strokeWidth = Number(item.querySelector('.edit-sw')?.value ?? layer.strokeWidth);
        layer.opacity     = Number(item.querySelector('.edit-opacity')?.value ?? 1);
        const labelText   = item.querySelector('.edit-label')?.value.trim();
        if (labelText) layer.label = { ...(layer.label ?? {}), text: labelText };
        else delete layer.label;
      } else if (layer.type === 'image') {
        layer.src     = item.querySelector('.edit-src')?.value.trim() ?? layer.src;
        layer.width   = Number(item.querySelector('.edit-img-w')?.value   ?? layer.width);
        layer.height  = Number(item.querySelector('.edit-img-h')?.value   ?? layer.height);
        layer.opacity = Number(item.querySelector('.edit-img-opacity')?.value ?? 1);
      } else {
        layer.fontSize = Number(item.querySelector('.edit-size')?.value  ?? layer.fontSize);
        layer.color    = item.querySelector('.edit-color')?.value ?? layer.color;
        layer.richText = item.querySelector('.edit-richtext')?.checked ?? false;
        if (!layer.richText) delete layer.richText;
        if (layer.type !== 'chronometer') {
          layer.text = (item.querySelector('.edit-text')?.value ?? '').trim() || layer.text;
        }
      }
      if (layer.type !== 'chronometer') {
        const startVal = item.querySelector('.edit-start')?.value;
        const endVal   = item.querySelector('.edit-end')?.value;
        if (startVal !== '' && startVal != null) layer.startTime = Number(startVal);
        else delete layer.startTime;
        if (endVal !== '' && endVal != null) layer.endTime = Number(endVal);
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

function loadTitlePresets(presets) {
  getActivePresetName(currentTitleId, (activeName) => {
    const titlePresets = presets[currentTitleId] ?? {};
    const names = Object.keys(titlePresets);
    currentPresetName = (activeName && titlePresets[activeName]) ? activeName : (names[0] ?? null);
    layers = currentPresetName ? (titlePresets[currentPresetName]?.layers ?? []) : [];
    renderPresetBar(currentTitleId, presets);
    renderList();
    pushLayers();
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0]?.id;
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { target: 'content', type: 'GET_TITLE_ID' }, (response) => {
    currentTitleId = response?.titleId ?? null;
    setTitleBar(currentTitleId);

    if (currentTitleId) {
      getPresets((presets) => loadTitlePresets(presets));
    } else {
      renderPresetBar(null, {});
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
        loadTitlePresets(presets);
        if (libraryOpen) renderPresetLibrary(currentTitleId, presets);
      });
    } else {
      layers = [];
      currentPresetName = null;
      renderPresetBar(null, {});
      renderList();
      if (libraryOpen) {
        document.getElementById('preset-library').style.display = 'none';
        libraryOpen = false;
      }
    }
  }
});

// --- Add new layer ---

document.getElementById('form-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const type   = document.getElementById('input-type').value;
  const x      = Number(document.getElementById('input-x').value);
  const y      = Number(document.getElementById('input-y').value);
  const group  = document.getElementById('input-group').value.trim();
  const startRaw = document.getElementById('input-start').value;
  const endRaw   = document.getElementById('input-end').value;
  const timing   = {
    ...(startRaw !== '' && { startTime: Number(startRaw) }),
    ...(endRaw   !== '' && { endTime:   Number(endRaw)   }),
  };

  let layer;
  if (type === 'shape') {
    const shape  = document.getElementById('input-shape').value;
    const labelT = document.getElementById('input-label').value.trim();
    layer = {
      type: 'shape', shape, x, y,
      width:       Number(document.getElementById('input-shape-w').value),
      height:      Number(document.getElementById('input-shape-h').value),
      fill:        document.getElementById('input-fill').value,
      stroke:      document.getElementById('input-stroke').value,
      strokeWidth: Number(document.getElementById('input-stroke-width').value),
      opacity:     Number(document.getElementById('input-shape-opacity').value),
      ...(labelT && { label: { text: labelT } }),
      animation:   document.getElementById('input-animation').value,
      ...timing,
    };
    if (layer.animation === 'none') delete layer.animation;
  } else if (type === 'image') {
    const src = document.getElementById('input-src').value.trim();
    if (!src) return;
    layer = {
      type: 'image', src, x, y,
      width:   Number(document.getElementById('input-img-w').value),
      height:  Number(document.getElementById('input-img-h').value),
      opacity: Number(document.getElementById('input-img-opacity').value),
      ...timing,
    };
  } else {
    const text = document.getElementById('input-text').value.trim();
    if (!text) return;
    const richText = document.getElementById('input-richtext').checked;
    layer = {
      text, x, y,
      fontSize: Number(document.getElementById('input-size').value),
      color:    document.getElementById('input-color').value,
      ...(richText && { richText: true }),
      ...timing,
    };
  }

  if (group) layer.group = group;
  layers.push(layer);
  pushLayers();
  renderList();

  // reset key fields
  document.getElementById('input-text').value = '';
  document.getElementById('input-src').value  = '';
  document.getElementById('input-label').value = '';
  document.getElementById('input-group').value = '';
  updatePreview();
});

// --- Save preset (named) ---

document.getElementById('btn-save-preset').addEventListener('click', () => {
  if (!currentTitleId) return;
  if (!currentPresetName) {
    const name = prompt('Preset name:', 'Default');
    if (!name?.trim()) return;
    currentPresetName = name.trim();
    setActivePresetName(currentTitleId, currentPresetName, () => {});
  }
  const btn = document.getElementById('btn-save-preset');
  saveNamedPreset(currentTitleId, currentPresetName, layers, () => {
    btn.textContent = '✓ Saved!';
    setTimeout(() => (btn.textContent = '💾 Save'), 1500);
    getPresets((presets) => {
      renderPresetBar(currentTitleId, presets);
      if (libraryOpen) renderPresetLibrary(currentTitleId, presets);
    });
  });
});

// --- Preset bar events (M3) ---

document.getElementById('preset-select').addEventListener('change', (e) => {
  if (!currentTitleId || !e.target.value) return;
  currentPresetName = e.target.value;
  setActivePresetName(currentTitleId, currentPresetName, () => {
    getPresets((presets) => {
      layers = presets[currentTitleId]?.[currentPresetName]?.layers ?? [];
      editingIndex = null;
      renderList();
      pushLayers();
      if (libraryOpen) renderPresetLibrary(currentTitleId, presets);
    });
  });
});

document.getElementById('btn-new-preset').addEventListener('click', () => {
  if (!currentTitleId) return;
  const name = prompt('New preset name:');
  if (!name?.trim()) return;
  const trimmed = name.trim();
  getPresets((presets) => {
    if (presets[currentTitleId]?.[trimmed]) {
      alert(`A preset named "${trimmed}" already exists.`);
      return;
    }
    saveNamedPreset(currentTitleId, trimmed, [], () => {
      currentPresetName = trimmed;
      layers = [];
      setActivePresetName(currentTitleId, trimmed, () => {
        getPresets((p) => {
          renderPresetBar(currentTitleId, p);
          renderList();
          pushLayers();
          if (libraryOpen) renderPresetLibrary(currentTitleId, p);
        });
      });
    });
  });
});

document.getElementById('btn-manage-presets').addEventListener('click', () => {
  const lib = document.getElementById('preset-library');
  libraryOpen = !libraryOpen;
  if (libraryOpen) {
    lib.style.display = '';
    getPresets((presets) => renderPresetLibrary(currentTitleId, presets));
  } else {
    lib.style.display = 'none';
  }
});

document.getElementById('btn-close-library').addEventListener('click', () => {
  document.getElementById('preset-library').style.display = 'none';
  libraryOpen = false;
});

document.getElementById('btn-import-preset').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !currentTitleId) return;
  e.target.value = '';
  importPresetFromFile(file, currentTitleId, (err, importedName) => {
    if (err) { alert('Import failed: ' + err.message); return; }
    currentPresetName = importedName;
    setActivePresetName(currentTitleId, importedName, () => {
      getPresets((presets) => {
        layers = presets[currentTitleId]?.[importedName]?.layers ?? [];
        editingIndex = null;
        renderPresetBar(currentTitleId, presets);
        renderList();
        pushLayers();
        if (libraryOpen) renderPresetLibrary(currentTitleId, presets);
      });
    });
  });
});

document.getElementById('btn-restore-defaults').addEventListener('click', () => {
  if (!currentTitleId) return;
  if (!confirm('Restore factory defaults for this title? This creates/overwrites the "Default" preset.')) return;
  loadFactoryDefault(currentTitleId, (err, defaultLayers) => {
    if (err) { alert('No factory defaults available for this title.'); return; }
    saveNamedPreset(currentTitleId, 'Default', defaultLayers, () => {
      currentPresetName = 'Default';
      layers = defaultLayers;
      setActivePresetName(currentTitleId, 'Default', () => {
        getPresets((presets) => {
          editingIndex = null;
          renderPresetBar(currentTitleId, presets);
          renderList();
          pushLayers();
          if (libraryOpen) renderPresetLibrary(currentTitleId, presets);
        });
      });
    });
  });
});

// --- Preset library event delegation (M3) ---

document.getElementById('preset-list').addEventListener('click', (e) => {
  const item = e.target.closest('.preset-item');
  if (!item || !currentTitleId) return;
  const presetName = item.dataset.preset;

  if (e.target.closest('.btn-preset-activate')) {
    currentPresetName = presetName;
    setActivePresetName(currentTitleId, presetName, () => {
      getPresets((presets) => {
        layers = presets[currentTitleId]?.[presetName]?.layers ?? [];
        editingIndex = null;
        renderPresetBar(currentTitleId, presets);
        renderList();
        pushLayers();
        renderPresetLibrary(currentTitleId, presets);
      });
    });
    return;
  }

  if (e.target.closest('.btn-preset-export')) {
    getPresets((presets) => {
      const data = presets[currentTitleId]?.[presetName];
      if (data) exportPresetToFile(currentTitleId, presetName, data);
    });
    return;
  }

  if (e.target.closest('.btn-preset-rename')) {
    const newName = prompt(`Rename "${presetName}" to:`, presetName);
    if (!newName?.trim() || newName.trim() === presetName) return;
    renameNamedPreset(currentTitleId, presetName, newName.trim(), () => {
      if (currentPresetName === presetName) currentPresetName = newName.trim();
      getPresets((presets) => {
        renderPresetBar(currentTitleId, presets);
        renderPresetLibrary(currentTitleId, presets);
      });
    });
    return;
  }

  if (e.target.closest('.btn-preset-delete')) {
    if (!confirm(`Delete preset "${presetName}"?`)) return;
    deleteNamedPreset(currentTitleId, presetName, () => {
      getPresets((presets) => {
        const names = Object.keys(presets[currentTitleId] ?? {});
        if (currentPresetName === presetName) {
          currentPresetName = names[0] ?? null;
          layers = currentPresetName ? (presets[currentTitleId][currentPresetName]?.layers ?? []) : [];
          if (currentPresetName) setActivePresetName(currentTitleId, currentPresetName, () => {});
          editingIndex = null;
          renderList();
          pushLayers();
        }
        renderPresetBar(currentTitleId, presets);
        renderPresetLibrary(currentTitleId, presets);
      });
    });
  }
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

// --- Type selector — show/hide form sections (M4) ---

function updateFormSections() {
  const type = document.getElementById('input-type').value;
  document.querySelectorAll('.form-section[data-for]').forEach((sec) => {
    sec.style.display = sec.dataset.for === type ? '' : 'none';
  });
  document.querySelectorAll('.form-field[data-for]').forEach((field) => {
    const types = field.dataset.for.split(' ');
    field.style.display = types.includes(type) ? '' : 'none';
  });
  const btn = document.getElementById('btn-add-submit');
  if (btn) btn.textContent = '＋ Add ' + type.charAt(0).toUpperCase() + type.slice(1);
}

document.getElementById('input-type').addEventListener('change', () => {
  updateFormSections();
  updatePreview();
});
updateFormSections();

// --- Drag mode toggle (M4.1) ---

const btnDrag = document.getElementById('btn-drag-mode');
if (btnDrag) {
  btnDrag.addEventListener('click', () => {
    dragModeActive = !dragModeActive;
    btnDrag.classList.toggle('active', dragModeActive);
    btnDrag.title = dragModeActive
      ? 'Drag mode ON — click to disable'
      : 'Toggle drag mode — move layers on the video';
    chrome.runtime.sendMessage({ target: 'content', type: 'SET_DRAG_MODE', enabled: dragModeActive });
  });
}

// --- Groups panel toggle (M4.4) ---

document.getElementById('btn-groups-toggle')?.addEventListener('click', () => {
  const panel = document.getElementById('groups-section');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});

document.getElementById('btn-close-groups')?.addEventListener('click', () => {
  const panel = document.getElementById('groups-section');
  if (panel) panel.style.display = 'none';
});

document.getElementById('groups-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-group-toggle');
  if (!btn) return;
  const name = btn.dataset.group;
  groupVisibility[name] = groupVisibility[name] === false ? true : false;
  pushLayers();
  renderList();
});

// --- Timeline toggle (M4.5) ---

document.getElementById('btn-timeline-toggle')?.addEventListener('click', () => {
  const panel = document.getElementById('timeline-section');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
  if (panel.style.display !== 'none') renderTimeline();
});

document.getElementById('btn-close-timeline')?.addEventListener('click', () => {
  const panel = document.getElementById('timeline-section');
  if (panel) panel.style.display = 'none';
});

// --- Handle LAYER_MOVED from drag on video (M4.1) ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'LAYER_MOVED') {
    const idx = message.index;
    if (idx >= 0 && idx < layers.length) {
      layers[idx].x = message.x;
      layers[idx].y = message.y;
      if (editingIndex !== idx) renderList();
    }
  }
});
