/**
 * @jest-environment jsdom
 */
import '../src/background/service-worker';

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

  describe('onMessage listener', () => {
    it('forwards message to active tab content script when target is "content"', () => {
      let listener;
      global.chrome.runtime.onMessage.addListener.mockImplementation((cb) => { listener = cb; });

      // Re-require to register listeners
      jest.resetModules();
      require('../src/background/service-worker');

      const sendResponse = jest.fn();
      const tabs = [{ id: 42 }];
      global.chrome.tabs.query.mockImplementation((query, cb) => cb(tabs));
      global.chrome.tabs.sendMessage.mockImplementation((tabId, msg, resp) => resp && resp());

      const result = listener({ target: 'content', foo: 'bar' }, {}, sendResponse);

      expect(global.chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function)
      );
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        { target: 'content', foo: 'bar' },
        sendResponse
      );
      expect(result).toBe(true);
    });

    it('does not forward message if target is not "content"', () => {
      let listener;
      global.chrome.runtime.onMessage.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      const sendResponse = jest.fn();
      const result = listener({ target: 'popup' }, {}, sendResponse);

      expect(global.chrome.tabs.query).not.toHaveBeenCalled();
      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('handles missing tabs or tab id gracefully', () => {
      let listener;
      global.chrome.runtime.onMessage.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      global.chrome.tabs.query.mockImplementation((query, cb) => cb([]));
      const sendResponse = jest.fn();
      const result = listener({ target: 'content' }, {}, sendResponse);

      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('onCommand listener', () => {
    it('toggles overlay when command is "toggle-overlay"', () => {
      let listener;
      global.chrome.commands.onCommand.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      const tabs = [{ id: 99 }];
      global.chrome.tabs.query.mockImplementation((query, cb) => cb(tabs));

      listener('toggle-overlay');

      expect(global.chrome.tabs.query).toHaveBeenCalledWith(
        { active: true, currentWindow: true },
        expect.any(Function)
      );
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
        99,
        { target: 'content', type: 'TOGGLE_VISIBILITY' }
      );
    });

    it('does nothing if command is not "toggle-overlay"', () => {
      let listener;
      global.chrome.commands.onCommand.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      listener('other-command');

      expect(global.chrome.tabs.query).not.toHaveBeenCalled();
      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('handles missing tabs or tab id gracefully', () => {
      let listener;
      global.chrome.commands.onCommand.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      global.chrome.tabs.query.mockImplementation((query, cb) => cb([]));

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

    it('seeds default presets on install if no user presets exist', async () => {
      let listener;
      global.chrome.runtime.onInstalled.addListener.mockImplementation((cb) => { listener = cb; });

      const defaults = { a: 1, b: 2 };
      global.fetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(defaults),
      });

      global.chrome.storage.sync.get.mockImplementation((key, cb) => cb({}));
      global.chrome.storage.sync.set.mockImplementation((obj) => {});

      jest.resetModules();
      require('../src/background/service-worker');

      await listener({ reason: 'install' });

      // Wait for promises to resolve
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith('src/default-presets.json');
      expect(global.chrome.storage.sync.get).toHaveBeenCalledWith('nto_presets', expect.any(Function));
      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ nto_presets: defaults });
    });

    it('merges user presets with defaults, preferring user values', async () => {
      let listener;
      global.chrome.runtime.onInstalled.addListener.mockImplementation((cb) => { listener = cb; });

      const defaults = { a: 1, b: 2 };
      const userPresets = { b: 99, c: 3 };
      global.fetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(defaults),
      });

      global.chrome.storage.sync.get.mockImplementation((key, cb) => cb({ nto_presets: userPresets }));
      global.chrome.storage.sync.set.mockImplementation((obj) => {});

      jest.resetModules();
      require('../src/background/service-worker');

      await listener({ reason: 'install' });

      await Promise.resolve();

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
        nto_presets: { a: 1, b: 99, c: 3 },
      });
    });

    it('does not seed presets on update or other reasons', async () => {
      let listener;
      global.chrome.runtime.onInstalled.addListener.mockImplementation((cb) => { listener = cb; });

      jest.resetModules();
      require('../src/background/service-worker');

      await listener({ reason: 'update' });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(global.chrome.storage.sync.get).not.toHaveBeenCalled();
      expect(global.chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('handles fetch or json errors gracefully', async () => {
      let listener;
      global.chrome.runtime.onInstalled.addListener.mockImplementation((cb) => { listener = cb; });

      global.fetch.mockRejectedValue(new Error('fetch failed'));

      jest.resetModules();
      require('../src/background/service-worker');

      await expect(listener({ reason: 'install' })).resolves.toBeUndefined();

      // Simulate fetch success but json() fails
      global.fetch.mockResolvedValue({
        json: jest.fn().mockRejectedValue(new Error('json failed')),
      });

      await expect(listener({ reason: 'install' })).resolves.toBeUndefined();
    });

    it('handles storage.get or set errors gracefully', async () => {
      let listener;
      global.chrome.runtime.onInstalled.addListener.mockImplementation((cb) => { listener = cb; });

      const defaults = { a: 1 };
      global.fetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(defaults),
      });

      // storage.get throws
      global.chrome.storage.sync.get.mockImplementation(() => { throw new Error('get failed'); });

      jest.resetModules();
      require('../src/background/service-worker');

      await expect(listener({ reason: 'install' })).resolves.toBeUndefined();

      // storage.set throws
      global.chrome.storage.sync.get.mockImplementation((key, cb) => cb({}));
      global.chrome.storage.sync.set.mockImplementation(() => { throw new Error('set failed'); });

      await expect(listener({ reason: 'install' })).resolves.toBeUndefined();
    });
  });
});
