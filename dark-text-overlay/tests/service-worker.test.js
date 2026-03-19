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
        sync: {
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

    it('seeds default presets on fresh install', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      const defaults = { '80114790': [] };
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(defaults) });
      global.chrome.storage.sync.get.mockImplementation((key, cb) => cb({}));

      listener({ reason: 'install' });
      await new Promise((r) => setTimeout(r, 0)); // flush microtasks

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ nto_presets: defaults });
    });

    it('preserves existing user presets on install (user values win)', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');
      const defaults = { a: [1], b: [2] };
      const userPresets = { b: [99], c: [3] };
      global.fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue(defaults) });
      global.chrome.storage.sync.get.mockImplementation((key, cb) =>
        cb({ nto_presets: userPresets }),
      );

      listener({ reason: 'install' });
      await new Promise((r) => setTimeout(r, 0));

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
        nto_presets: { a: [1], b: [99], c: [3] },
      });
    });

    it('does not seed on update', async () => {
      const listener = loadAndCapture('runtime.onInstalled.addListener');

      listener({ reason: 'update' });
      await new Promise((r) => setTimeout(r, 0));

      expect(global.fetch).not.toHaveBeenCalled();
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
