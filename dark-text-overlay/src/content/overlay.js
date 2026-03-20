(() => {
  const PRESETS_KEY = 'nto_presets';

  // Pure utilities (also used by tests)
  const { formatTime, getTitleIdFromUrl, getVisibleLayers, layerKey } = (() => {
    const m = window.__ntoUtils;
    if (m) return m;
    // Inline fallback (loaded via <script> in tests, or injected as module)
    return {
      formatTime(seconds) {
        const s = Math.floor(seconds);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${mm}:${ss}`;
      },
      getTitleIdFromUrl(pathname) {
        const match = pathname.match(/\/(?:watch|title)\/(\d+)/);
        return match ? match[1] : null;
      },
      getVisibleLayers(layers, currentTime) {
        return layers.filter((layer) => {
          if (layer.startTime == null && layer.endTime == null) return true;
          if (currentTime == null) return false;
          const afterStart = layer.startTime == null || currentTime >= layer.startTime;
          const beforeEnd = layer.endTime == null || currentTime <= layer.endTime;
          return afterStart && beforeEnd;
        });
      },
      layerKey(layer, currentTime) {
        if (layer.type === 'chronometer') return `chrono-${Math.floor(currentTime ?? 0)}`;
        return `${layer.startTime ?? ''}-${layer.endTime ?? ''}-${layer.text}`;
      },
    };
  })();

  // --- Shadow DOM container (isolated from Netflix styles) ---
  const host = document.createElement('div');
  host.id = 'nto-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .nto-layer {
      position: absolute;
      color: white;
      font-family: sans-serif;
      font-size: 24px;
      text-shadow: 1px 1px 3px black;
      user-select: none;
      pointer-events: none;
      white-space: pre-wrap;
    }
    .nto-layer strong { font-weight: 700; }
    .nto-layer em     { font-style: italic; }
    .nto-layer.nto-draggable { pointer-events: auto; cursor: move; }
    .nto-shape { position: absolute; pointer-events: none; overflow: visible; }
    .nto-shape.nto-draggable { pointer-events: auto; cursor: move; }
    .nto-image { position: absolute; pointer-events: none; object-fit: contain; }
    .nto-image.nto-draggable { pointer-events: auto; cursor: move; }
    @keyframes nto-fade-in  { from { opacity:0 } to { opacity:1 } }
    @keyframes nto-scale-in { from { transform:scale(0); opacity:0 } to { transform:scale(1); opacity:1 } }
    @keyframes nto-draw-on  { from { stroke-dashoffset:2000 } to { stroke-dashoffset:0 } }
  `;
  shadow.appendChild(style);

  // --- State ---
  let layers = [];
  let currentTitleId = null;
  let debounceTimer = null;
  let tickTimer = null;
  let lastVisibleKeys = null;
  const observers = [];

  // --- Drag state (M4.1) ---
  let dragMode = false;
  let dragTarget = null;
  let dragLayerIndex = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  // --- Helpers ---

  // Netflix player embeds a "back to show" anchor like /title/80100172.
  // This lets us resolve an episode watch ID → parent show title ID.
  function getShowIdFromDom() {
    // JSON-LD structured data (most reliable)
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const url = data.url ?? data.partOfSeries?.url;
        const m = url?.match(/\/title\/(\d+)/);
        if (m) return m[1];
      } catch (_) { /* no JSON-LD */ }
    }
    // Fallback: any anchor pointing to a /title/ URL
    for (const a of document.querySelectorAll('a[href*="/title/"]')) {
      const m = a.href.match(/\/title\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getVideoTime() {
    const video = document.querySelector('video');
    return video ? video.currentTime : null;
  }

  // --- Rich text parser (4.2) — sanitise then apply inline markdown ---
  function parseRichText(raw) {
    return String(raw)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // --- Shape SVG builder (4.6 + 4.7 + 4.8) ---
  function buildShapeElement(layer) {
    const ns = 'http://www.w3.org/2000/svg';
    const w = layer.width ?? 100;
    const h = layer.height ?? 60;
    const fill   = layer.fill        ?? 'none';
    const stroke = layer.stroke      ?? '#ffffff';
    const sw     = layer.strokeWidth ?? 2;
    const shape  = layer.shape       ?? 'rect';

    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('nto-shape');
    if (dragMode) svg.classList.add('nto-draggable');
    svg.style.cssText = `left:${layer.x ?? 20}px;top:${layer.y ?? 20}px;width:${w}px;height:${h + 30}px;opacity:${layer.opacity ?? 1};`;

    let el;
    const pad = sw;
    if (shape === 'rect') {
      el = document.createElementNS(ns, 'rect');
      el.setAttribute('x', pad / 2);      el.setAttribute('y', pad / 2);
      el.setAttribute('width', w - pad); el.setAttribute('height', h - pad);
      el.setAttribute('rx', '3');
    } else if (shape === 'circle' || shape === 'ellipse') {
      el = document.createElementNS(ns, 'ellipse');
      el.setAttribute('cx', w / 2);          el.setAttribute('cy', h / 2);
      el.setAttribute('rx', w / 2 - pad / 2); el.setAttribute('ry', h / 2 - pad / 2);
    } else if (shape === 'line') {
      el = document.createElementNS(ns, 'line');
      el.setAttribute('x1', 0); el.setAttribute('y1', h / 2);
      el.setAttribute('x2', w); el.setAttribute('y2', h / 2);
    } else if (shape === 'arrow') {
      const mid = `nto-arr-${Math.random().toString(36).slice(2, 7)}`;
      const defs   = document.createElementNS(ns, 'defs');
      const marker = document.createElementNS(ns, 'marker');
      marker.setAttribute('id', mid);
      marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', '8');        marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', '0 0,8 3,0 6'); poly.setAttribute('fill', stroke);
      marker.appendChild(poly); defs.appendChild(marker); svg.appendChild(defs);
      el = document.createElementNS(ns, 'line');
      el.setAttribute('x1', 0);       el.setAttribute('y1', h / 2);
      el.setAttribute('x2', w - 10);  el.setAttribute('y2', h / 2);
      el.setAttribute('marker-end', `url(#${mid})`);
    } else if (shape === 'polygon') {
      el = document.createElementNS(ns, 'polygon');
      el.setAttribute('points', `${w / 2},${pad / 2} ${w - pad / 2},${h - pad / 2} ${pad / 2},${h - pad / 2}`);
    }

    if (el) {
      el.setAttribute('fill', fill);
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', sw);
      // draw-on animation needs stroke-dasharray set
      if (layer.animation === 'draw-on') {
        el.setAttribute('stroke-dasharray', '2000');
        el.style.animation = 'nto-draw-on 1s linear forwards';
      } else if (layer.animation && layer.animation !== 'none') {
        svg.style.animation = `nto-${layer.animation} 0.4s ease-out both`;
      }
      svg.appendChild(el);
    }

    // Shape + text label (4.7)
    if (layer.label?.text) {
      const t = document.createElementNS(ns, 'text');
      const lfs = layer.label.fontSize ?? 14;
      t.setAttribute('x', w / 2); t.setAttribute('y', h + lfs + 2);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', layer.label.color ?? '#ffffff');
      t.setAttribute('font-size', lfs);
      t.setAttribute('font-family', 'sans-serif');
      t.textContent = layer.label.text;
      svg.appendChild(t);
    }

    return svg;
  }

  function renderLayers(visibleLayers, currentTime) {
    shadow.querySelectorAll('.nto-layer, .nto-shape, .nto-image').forEach((el) => el.remove());
    visibleLayers.forEach((layer, visIdx) => {
      // Shape layer (4.6)
      if (layer.type === 'shape') {
        const svg = buildShapeElement(layer);
        svg.dataset.layerIndex = layers.indexOf(layer);
        shadow.appendChild(svg);
        return;
      }

      // Image layer (4.3)
      if (layer.type === 'image') {
        const img = document.createElement('img');
        img.className = 'nto-image' + (dragMode ? ' nto-draggable' : '');
        img.src = layer.src ?? '';
        img.dataset.layerIndex = layers.indexOf(layer);
        img.style.cssText = `left:${layer.x ?? 20}px;top:${layer.y ?? 20}px;width:${layer.width ?? 80}px;height:${layer.height ?? 80}px;opacity:${layer.opacity ?? 1};`;
        shadow.appendChild(img);
        return;
      }

      // Text / chronometer layer
      const el = document.createElement('div');
      el.className = 'nto-layer' + (dragMode ? ' nto-draggable' : '');
      el.dataset.layerIndex = layers.indexOf(layer);
      if (layer.type === 'chronometer') {
        el.textContent = (layer.activated ?? true) ? formatTime(currentTime ?? 0) : formatTime(0);
      } else if (layer.richText) {
        el.innerHTML = parseRichText(layer.text ?? '');
      } else {
        el.textContent = layer.text;
      }
      el.style.cssText = `left:${layer.x ?? 20}px;top:${layer.y ?? 20}px;font-size:${layer.fontSize ?? 24}px;color:${layer.color ?? 'white'};`;
      shadow.appendChild(el);
    });
  }

  function startTick() {
    if (tickTimer !== null) return;
    tickTimer = setInterval(() => {
      const currentTime = getVideoTime();
      const visible = getVisibleLayers(layers, currentTime);
      const keys = visible.map((l) => layerKey(l, currentTime)).join('|');
      if (keys !== lastVisibleKeys) {
        lastVisibleKeys = keys;
        renderLayers(visible, currentTime);
      }
    }, 500);
  }

  function stopTick() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    lastVisibleKeys = null;
  }

  function loadPresetForTitle(titleId) {
    if (!titleId) {
      layers = [];
      stopTick();
      renderLayers([]);
      return;
    }

    try {
      chrome.storage.sync.get([PRESETS_KEY, 'nto_active'], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('[NTO] storage.sync.get error:', chrome.runtime.lastError.message);
          return;
        }
        const presets = result[PRESETS_KEY] ?? {};
        const active = result['nto_active'] ?? {};

        function resolveTitle(id) {
          const titleData = presets[id];
          if (!titleData) return null;
          // Backward-compat: old flat-array format
          if (Array.isArray(titleData)) return titleData;
          // New named-preset format: pick active or first preset
          const name = active[id] ?? Object.keys(titleData)[0];
          return titleData[name]?.layers ?? null;
        }

        const resolved = resolveTitle(titleId);
        if (resolved !== null) {
          layers = resolved;
          startTick();
          return;
        }

        const showId = getShowIdFromDom();
        const fallback = showId ? resolveTitle(showId) : null;
        layers = fallback ?? [];
        if (layers.length > 0) startTick();
        else { stopTick(); renderLayers([]); }
      });
    } catch (err) {
      console.warn('[NTO] Failed to load preset:', err);
    }
  }

  // Debounced so rapid SPA mutations don't trigger multiple concurrent loads
  function onUrlChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newTitleId = getTitleIdFromUrl(window.location.pathname);
      if (newTitleId === currentTitleId) return;
      currentTitleId = newTitleId;
      loadPresetForTitle(currentTitleId);
      chrome.runtime.sendMessage({ type: 'TITLE_CHANGED', titleId: currentTitleId }).catch(() => {});
    }, 400);
  }

  // --- SPA navigation detection ---
  window.addEventListener('popstate', onUrlChange);

  const observeTitle = () => {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const obs = new MutationObserver(onUrlChange);
      obs.observe(titleEl, { childList: true });
      observers.push(obs);
    }
  };
  observeTitle();
  const headObserver = new MutationObserver(observeTitle);
  headObserver.observe(document.head ?? document.documentElement, {
    childList: true,
    subtree: true,
  });
  observers.push(headObserver);

  // --- Drag mode event listeners (4.1) ---
  shadow.addEventListener('mousedown', (e) => {
    if (!dragMode) return;
    const target = e.target.closest('.nto-draggable');
    if (!target) return;
    dragTarget    = target;
    dragLayerIndex = parseInt(target.dataset.layerIndex ?? '-1', 10);
    dragStartX    = e.clientX;
    dragStartY    = e.clientY;
    dragOriginX   = layers[dragLayerIndex]?.x ?? 0;
    dragOriginY   = layers[dragLayerIndex]?.y ?? 0;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragMode || !dragTarget || dragLayerIndex < 0) return;
    const newX = Math.max(0, dragOriginX + (e.clientX - dragStartX));
    const newY = Math.max(0, dragOriginY + (e.clientY - dragStartY));
    dragTarget.style.left = newX + 'px';
    dragTarget.style.top  = newY + 'px';
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragMode || !dragTarget || dragLayerIndex < 0) return;
    const newX = Math.round(Math.max(0, dragOriginX + (e.clientX - dragStartX)));
    const newY = Math.round(Math.max(0, dragOriginY + (e.clientY - dragStartY)));
    if (layers[dragLayerIndex]) {
      layers[dragLayerIndex].x = newX;
      layers[dragLayerIndex].y = newY;
      chrome.runtime.sendMessage({ type: 'LAYER_MOVED', index: dragLayerIndex, x: newX, y: newY }).catch(() => {});
    }
    dragTarget = null;
    dragLayerIndex = -1;
  });

  // --- Cleanup on unload ---
  window.addEventListener('pagehide', () => {
    stopTick();
    clearTimeout(debounceTimer);
    observers.forEach((obs) => obs.disconnect());
    observers.length = 0;
  });

  // --- Init ---
  currentTitleId = getTitleIdFromUrl(window.location.pathname);
  loadPresetForTitle(currentTitleId);

  // --- Listen for messages from popup ---
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.target !== 'content') return;

    if (message.type === 'UPDATE_LAYERS') {
      layers = message.layers;
      stopTick();
      if (layers.length > 0) startTick();
      else renderLayers([]);
    }

    if (message.type === 'TOGGLE_VISIBILITY') {
      host.style.display = host.style.display === 'none' ? '' : 'none';
    }

    if (message.type === 'SET_DRAG_MODE') {
      dragMode = message.enabled;
      host.style.pointerEvents = dragMode ? 'auto' : 'none';
      // Re-render so draggable class is applied/removed
      lastVisibleKeys = null;
      const ct = getVideoTime();
      renderLayers(getVisibleLayers(layers, ct), ct);
    }

    if (message.type === 'GET_TITLE_ID') {
      sendResponse({ titleId: currentTitleId });
      return true;
    }

    if (message.type === 'GET_VIDEO_TIME') {
      const video = document.querySelector('video');
      sendResponse({ currentTime: video ? video.currentTime : null });
      return true;
    }
  });
})();
