// service-worker.test.js
// Adapted from ai_workflow-generated draft in test/background/service-worker.test.js.
// Tests the two onMessage + onCommand listeners; onInstalled covered separately.

describe('service-worker', () => {
  let originalChrome;

  beforeEach(() => {
    originalChrome = global.chrome;
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        getURL: jest.fn((url) => url),
      },
      tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
      },
      commands: {
        onCommand: { addListener: jest.fn() },
      },
      storage: {
        local: {
          get: jest.fn(),
          set: jest.fn(),
        },
      },
    };
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.chrome = originalChrome;
    jest.resetModules();
  });

  // Helper: load service-worker and capture a specific listener
  function loadAndCapture(listenerPath) {
    let captured;
    const parts = listenerPath.split('.');
    let obj = global.chrome;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]].mockImplementation((cb) => { captured = cb; });
    jest.resetModules();
    require('../src/background/service-worker');
    return captured;
  }

  describe('onMessage listener', () => {
    it('forwards message to active tab content script when target is "content"', () => {
      const listener = loadAndCapture('runtime.onMessage.addListener');
      const sendResponse = jest.fn();
      global.chrome.tabs.query.mockImplementation((q, cb) => cb([{ id: 42 }]));

      const result = listener({ target: 'content', foo: 'bar' }, {}, sendResponse);

      expect(global.chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function),
      );
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        { target: 'content', foo: 'bar' },
        sendResponse,
      );
      expect(result).toBe(true);
    });

    it('does not forward message when target is not "content"', () => {
      const listener = loadAndCapture('runtime.onMessage.addListener');
      const result = listener({ target: 'popup' }, {}, jest.fn());

      expect(global.chrome.tabs.query).not.toHaveBeenCalled();
      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('handles empty tab list gracefully', () => {
      const listener = loadAndCapture('runtime.onMessage.addListener');
      global.chrome.tabs.query.mockImplementation((q, cb) => cb([]));

      const result = listener({ target: 'content' }, {}, jest.fn());

      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('onCommand listener', () => {
    it('sends TOGGLE_VISIBILITY to active tab when command is "toggle-overlay"', () => {
      const listener = loadAndCapture('commands.onCommand.addListener');
      global.chrome.tabs.query.mockImplementation((q, cb) => cb([{ id: 99 }]));

      listener('toggle-overlay');

      expect(global.chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function),
      );
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        99,
        { target: 'content', type: 'TOGGLE_VISIBILITY' },
      );
    });

    it('does nothing for unknown commands', () => {
      const listener = loadAndCapture('commands.onCommand.addListener');

      listener('some-other-command');

      expect(global.chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('handles empty tab list gracefully', () => {
      const listener = loadAndCapture('commands.onCommand.addListener');
      global.chrome.tabs.query.mockImplementation((q, cb) => cb([]));

      listener('toggle-overlay');

      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('onInstalled listener', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    // Named-format bundle used across the additive-merge tests.
    const namedDefaults = {
      '80114790': {
        Default: { layers: [], created: 0, modified: 0 },
        Bullets: { layers: [], created: 0, modified: 0 },
      },
    };

    it('seeds all bundled presets on fresh install (empty storage)', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(namedDefaults) });
      global.chrome.storage.local.get.mockImplementation((key, cb) => cb({}));

      listener({ reason: 'install' });
      await new Promise((r) => setTimeout(r, 0)); // flush microtasks

      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ nto_presets: namedDefaults });
    });

    it('adds a new bundled preset to an existing title without overwriting user edits', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      const existing = { '80114790': { Default: { layers: ['user'], created: 1, modified: 2 } } };
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(namedDefaults) });
      global.chrome.storage.local.get.mockImplementation((key, cb) =>
        cb({ nto_presets: existing }),
      );

      listener({ reason: 'update' });
      await new Promise((r) => setTimeout(r, 0));

      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
        nto_presets: {
          '80114790': {
            Default: { layers: ['user'], created: 1, modified: 2 }, // user's version preserved
            Bullets: { layers: [], created: 0, modified: 0 },        // added from the bundle
          },
        },
      });
    });

    it('seeds on update too, so new bundled presets reach existing installs', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(namedDefaults) });
      global.chrome.storage.local.get.mockImplementation((key, cb) =>
        cb({ nto_presets: { '80100172': { Default: { layers: [] } } } }),
      );

      listener({ reason: 'update' });
      await new Promise((r) => setTimeout(r, 0));

      expect(global.fetch).toHaveBeenCalled();
    });

    it('upgrades legacy flat-array presets to named format', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue({}) });
      global.chrome.storage.local.get.mockImplementation((key, cb) =>
        cb({ nto_presets: { '80100172': [{ text: 'x' }] } }),
      );

      listener({ reason: 'update' });
      await new Promise((r) => setTimeout(r, 0));

      const saved = global.chrome.storage.local.set.mock.calls[0][0].nto_presets;
      expect(Array.isArray(saved['80100172'])).toBe(false);
      expect(saved['80100172'].Default.layers).toEqual([{ text: 'x' }]);
    });

    it('handles fetch errors without throwing (unhandled rejection)', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      global.fetch.mockRejectedValue(new Error('network error'));

      // Should not throw — error is caught and console.warn'd
      expect(() => listener({ reason: 'install' })).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
    });
  });
});
