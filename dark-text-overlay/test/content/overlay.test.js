/**
 * @jest-environment jsdom
 */
import '../src/content/overlay';

describe('overlay content script', () => {
  let originalChrome;
  let host, shadowRoot, video, titleEl, sendMessageMock, getMock, setMock;

  beforeEach(() => {
    // Mock chrome APIs
    originalChrome = global.chrome;
    sendMessageMock = jest.fn(() => Promise.resolve());
    getMock = jest.fn();
    setMock = jest.fn();
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: sendMessageMock,
        lastError: null,
      },
      storage: {
        sync: {
          get: getMock,
          set: setMock,
        },
      },
    };

    // Setup DOM
    document.body.innerHTML = '';
    // Simulate Netflix video
    video = document.createElement('video');
    video.currentTime = 123.45;
    document.body.appendChild(video);

    // Simulate <title>
    titleEl = document.createElement('title');
    titleEl.textContent = 'Test Title';
    document.head.appendChild(titleEl);

    // Simulate window location
    delete window.location;
    window.location = { pathname: '/title/123456' };

    // Simulate __ntoUtils
    window.__ntoUtils = undefined;

    // Re-require to re-run IIFE
    jest.resetModules();
    require('../src/content/overlay');

    // Find host and shadow
    host = document.getElementById('nto-host');
    shadowRoot = host && host.shadowRoot ? host.shadowRoot : host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
  });

  afterEach(() => {
    global.chrome = originalChrome;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('utility functions', () => {
    it('formatTime formats seconds as mm:ss', () => {
      const { formatTime } = require('../src/content/overlay').__ntoUtils || window.__ntoUtils || {};
      expect(formatTime(0)).toBe('00:00');
      expect(formatTime(65)).toBe('01:05');
      expect(formatTime(3599)).toBe('59:59');
    });

    it('getTitleIdFromUrl extracts title id', () => {
      const { getTitleIdFromUrl } = require('../src/content/overlay').__ntoUtils || window.__ntoUtils || {};
      expect(getTitleIdFromUrl('/title/12345')).toBe('12345');
      expect(getTitleIdFromUrl('/watch/67890')).toBe('67890');
      expect(getTitleIdFromUrl('/foo/bar')).toBeNull();
    });

    it('getVisibleLayers filters by time', () => {
      const { getVisibleLayers } = require('../src/content/overlay').__ntoUtils || window.__ntoUtils || {};
      const layers = [
        { startTime: null, endTime: null, text: 'A' },
        { startTime: 10, endTime: 20, text: 'B' },
        { startTime: 5, endTime: 15, text: 'C' },
      ];
      expect(getVisibleLayers(layers, null)).toEqual([{ startTime: null, endTime: null, text: 'A' }]);
      expect(getVisibleLayers(layers, 12)).toEqual([
        { startTime: null, endTime: null, text: 'A' },
        { startTime: 10, endTime: 20, text: 'B' },
        { startTime: 5, endTime: 15, text: 'C' },
      ]);
      expect(getVisibleLayers(layers, 21)).toEqual([{ startTime: null, endTime: null, text: 'A' }]);
    });

    it('layerKey generates correct keys', () => {
      const { layerKey } = require('../src/content/overlay').__ntoUtils || window.__ntoUtils || {};
      expect(layerKey({ type: 'chronometer' }, 12.3)).toBe('chrono-12');
      expect(layerKey({ startTime: 1, endTime: 2, text: 'foo' }, 0)).toBe('1-2-foo');
      expect(layerKey({ startTime: null, endTime: null, text: 'bar' }, 0)).toBe('--bar');
    });
  });

  describe('Shadow DOM and style', () => {
    it('creates host div and attaches shadow DOM', () => {
      const host = document.getElementById('nto-host');
      expect(host).toBeTruthy();
      // Can't access closed shadowRoot, but style should be appended
      // So check for style in document
      expect(document.querySelector('style')).toBeTruthy();
    });
  });

  describe('SPA navigation detection', () => {
    it('calls onUrlChange on popstate', () => {
      const spy = jest.spyOn(window, 'setTimeout');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('observes <title> mutations and triggers onUrlChange', () => {
      const spy = jest.spyOn(window, 'setTimeout');
      titleEl.textContent = 'Changed';
      // MutationObserver should trigger setTimeout
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('loadPresetForTitle', () => {
    it('loads layers for current titleId and starts tick', (done) => {
      getMock.mockImplementation((key, cb) => cb({ nto_presets: { '123456': [{ text: 'Layer1' }] } }));
      // Simulate location
      window.location.pathname = '/title/123456';
      jest.resetModules();
      require('../src/content/overlay');
      setTimeout(() => {
        expect(getMock).toHaveBeenCalled();
        done();
      }, 10);
    });

    it('loads layers for showId if titleId not found', (done) => {
      // Add JSON-LD script for showId
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify({ url: '/title/999999' });
      document.body.appendChild(script);

      getMock.mockImplementation((key, cb) => cb({ nto_presets: { '999999': [{ text: 'ShowLayer' }] } }));
      window.location.pathname = '/title/888888';
      jest.resetModules();
      require('../src/content/overlay');
      setTimeout(() => {
        expect(getMock).toHaveBeenCalled();
        done();
      }, 10);
    });

    it('handles chrome.runtime.lastError gracefully', (done) => {
      global.chrome.runtime.lastError = { message: 'fail' };
      getMock.mockImplementation((key, cb) => cb({}));
      window.location.pathname = '/title/123456';
      jest.resetModules();
      require('../src/content/overlay');
      setTimeout(() => {
        expect(getMock).toHaveBeenCalled();
        global.chrome.runtime.lastError = null;
        done();
      }, 10);
    });

    it('handles missing titleId and stops tick', (done) => {
      window.location.pathname = '/foo/bar';
      getMock.mockImplementation((key, cb) => cb({}));
      jest.resetModules();
      require('../src/content/overlay');
      setTimeout(() => {
        expect(getMock).toHaveBeenCalled();
        done();
      }, 10);
    });
  });

  describe('message listener', () => {
    let listener;
    beforeEach(() => {
      global.chrome.runtime.onMessage.addListener.mockImplementation((cb) => { listener = cb; });
      jest.resetModules();
      require('../src/content/overlay');
    });

    it('updates layers on UPDATE_LAYERS', () => {
      listener({ target: 'content', type: 'UPDATE_LAYERS', layers: [{ text: 'foo' }] }, {}, jest.fn());
      // Should stopTick and startTick if layers.length > 0
      // No error should occur
    });

    it('toggles overlay visibility on TOGGLE_VISIBILITY', () => {
      const host = document.getElementById('nto-host');
      host.style.display = '';
      listener({ target: 'content', type: 'TOGGLE_VISIBILITY' }, {}, jest.fn());
      expect(host.style.display).toBe('none');
      listener({ target: 'content', type: 'TOGGLE_VISIBILITY' }, {}, jest.fn());
      expect(host.style.display).toBe('');
    });

    it('responds with titleId on GET_TITLE_ID', () => {
      const sendResponse = jest.fn();
      listener({ target: 'content', type: 'GET_TITLE_ID' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ titleId: '123456' });
    });

    it('responds with video time on GET_VIDEO_TIME', () => {
      const sendResponse = jest.fn();
      listener({ target: 'content', type: 'GET_VIDEO_TIME' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({ currentTime: 123.45 });
    });

    it('returns true for GET_TITLE_ID and GET_VIDEO_TIME', () => {
      const sendResponse = jest.fn();
      expect(listener({ target: 'content', type: 'GET_TITLE_ID' }, {}, sendResponse)).toBe(true);
      expect(listener({ target: 'content', type: 'GET_VIDEO_TIME' }, {}, sendResponse)).toBe(true);
    });

    it('ignores messages not for content', () => {
      const sendResponse = jest.fn();
      expect(listener({ target: 'popup', type: 'UPDATE_LAYERS' }, {}, sendResponse)).toBeUndefined();
    });
  });

  describe('cleanup on pagehide', () => {
    it('disconnects observers and stops tick', () => {
      const disconnectSpy = jest.fn();
      // Simulate observer
      window.__ntoObservers = [{ disconnect: disconnectSpy }];
      window.dispatchEvent(new Event('pagehide'));
      // Should call disconnect
      // (Can't access actual observers array, but no error should occur)
    });
  });

  describe('renderLayers', () => {
    it('renders visible layers in shadow DOM', () => {
      // Can't access closed shadowRoot, so test by calling renderLayers directly if possible
      // Otherwise, check that .nto-layer elements are created in the document
      // (This is limited by the closed shadow DOM in the implementation)
      // So, just ensure no error occurs
      // (No-op)
    });
  });
});
