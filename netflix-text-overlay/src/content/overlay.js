(() => {
  const PRESETS_KEY = 'nto_presets';

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

  // --- Helpers ---

  function getTitleIdFromUrl() {
    // Episode player:  /watch/80906021
    // Show title page: /title/80100172
    const m = window.location.pathname.match(/\/(?:watch|title)\/(\d+)/);
    return m ? m[1] : null;
  }

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
      } catch {}
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

  function getVisibleLayers(currentTime) {
    return layers.filter((layer) => {
      if (layer.startTime == null && layer.endTime == null) return true;
      if (currentTime == null) return false;
      const afterStart = layer.startTime == null || currentTime >= layer.startTime;
      const beforeEnd = layer.endTime == null || currentTime <= layer.endTime;
      return afterStart && beforeEnd;
    });
  }

  function renderLayers(visibleLayers) {
    shadow.querySelectorAll('.nto-layer').forEach((el) => el.remove());
    visibleLayers.forEach((layer) => {
      const el = document.createElement('div');
      el.className = 'nto-layer';
      el.textContent = layer.text;
      el.style.cssText = `
        left: ${layer.x ?? 20}px;
        top: ${layer.y ?? 20}px;
        font-size: ${layer.fontSize ?? 24}px;
        color: ${layer.color ?? 'white'};
      `;
      shadow.appendChild(el);
    });
  }

  function layerKey(layer) {
    return `${layer.startTime ?? ''}-${layer.endTime ?? ''}-${layer.text}`;
  }

  function startTick() {
    if (tickTimer !== null) return;
    tickTimer = setInterval(() => {
      const currentTime = getVideoTime();
      const visible = getVisibleLayers(currentTime);
      const keys = visible.map(layerKey).join('|');
      if (keys !== lastVisibleKeys) {
        lastVisibleKeys = keys;
        renderLayers(visible);
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

    chrome.storage.sync.get(PRESETS_KEY, (result) => {
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
  }

  // Debounced so rapid SPA mutations don't trigger multiple concurrent loads
  function onUrlChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newTitleId = getTitleIdFromUrl();
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
    if (titleEl) new MutationObserver(onUrlChange).observe(titleEl, { childList: true });
  };
  observeTitle();
  new MutationObserver(observeTitle).observe(document.head ?? document.documentElement, {
    childList: true,
    subtree: true,
  });

  // --- Init ---
  currentTitleId = getTitleIdFromUrl();
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
  });
})();
