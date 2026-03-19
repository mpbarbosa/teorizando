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
  `;
  shadow.appendChild(style);

  // --- State ---
  let layers = [];
  let currentTitleId = null;
  let debounceTimer = null;
  let tickTimer = null;
  let lastVisibleKeys = null;
  const observers = [];

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

  function renderLayers(visibleLayers, currentTime) {
    shadow.querySelectorAll('.nto-layer').forEach((el) => el.remove());
    visibleLayers.forEach((layer) => {
      const el = document.createElement('div');
      el.className = 'nto-layer';
      el.textContent = layer.type === 'chronometer'
        ? formatTime(currentTime ?? 0)
        : layer.text;
      el.style.cssText = `
        left: ${layer.x ?? 20}px;
        top: ${layer.y ?? 20}px;
        font-size: ${layer.fontSize ?? 24}px;
        color: ${layer.color ?? 'white'};
      `;
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
      chrome.storage.sync.get(PRESETS_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('[NTO] storage.sync.get error:', chrome.runtime.lastError.message);
          return;
        }
        const presets = result[PRESETS_KEY] ?? {};

        if (presets[titleId]) {
          layers = presets[titleId];
          startTick();
          return;
        }

        const showId = getShowIdFromDom();
        layers = (showId && presets[showId]) ? presets[showId] : [];
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
