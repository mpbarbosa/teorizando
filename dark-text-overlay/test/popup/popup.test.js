/**
 * @jest-environment jsdom
 */

import * as popup from '../../src/popup/popup';

describe('popup.js', () => {
  describe('formatTime', () => {
    it('formats seconds as mm:ss', () => {
      expect(popup.formatTime(0)).toBe('00:00');
      expect(popup.formatTime(5)).toBe('00:05');
      expect(popup.formatTime(65)).toBe('01:05');
      expect(popup.formatTime(3599)).toBe('59:59');
      expect(popup.formatTime(3600)).toBe('60:00');
    });

    it('truncates fractional seconds', () => {
      expect(popup.formatTime(61.9)).toBe('01:01');
    });

    it('pads single-digit minutes and seconds', () => {
      expect(popup.formatTime(9)).toBe('00:09');
      expect(popup.formatTime(70)).toBe('01:10');
    });
  });

  describe('escHtml', () => {
    it('escapes &, <, >, "', () => {
      expect(popup.escHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
    });

    it('returns empty string for empty input', () => {
      expect(popup.escHtml('')).toBe('');
    });

    it('handles non-string input', () => {
      expect(popup.escHtml(123)).toBe('123');
      expect(popup.escHtml(null)).toBe('null');
      expect(popup.escHtml(undefined)).toBe('undefined');
    });
  });

  describe('buildTimingBadge', () => {
    it('returns chrono badge for chronometer type', () => {
      expect(popup.buildTimingBadge({ type: 'chronometer' })).toContain('⏱ chrono');
    });

    it('returns empty string if startTime and endTime are null', () => {
      expect(popup.buildTimingBadge({ type: 'text', startTime: null, endTime: null })).toBe('');
    });

    it('formats start and end times', () => {
      expect(
        popup.buildTimingBadge({ type: 'text', startTime: 10, endTime: 20 })
      ).toContain('00:10 → 00:20');
    });

    it('uses 00:00 for missing startTime and ∞ for missing endTime', () => {
      expect(
        popup.buildTimingBadge({ type: 'text', startTime: null, endTime: 20 })
      ).toContain('00:00 → 00:20');
      expect(
        popup.buildTimingBadge({ type: 'text', startTime: 10, endTime: null })
      ).toContain('00:10 → ∞');
    });
  });

  describe('buildEditForm', () => {
    it('renders text edit form for non-chronometer', () => {
      const html = popup.buildEditForm({ type: 'text', text: 'foo', x: 1, y: 2, fontSize: 12, color: '#fff' });
      expect(html).toContain('textarea');
      expect(html).toContain('edit-x');
      expect(html).toContain('edit-y');
      expect(html).toContain('edit-size');
      expect(html).toContain('edit-color');
      expect(html).toContain('edit-start');
      expect(html).toContain('edit-end');
      expect(html).toContain('btn-edit-save');
      expect(html).toContain('btn-edit-cancel');
    });

    it('renders chrono label for chronometer', () => {
      const html = popup.buildEditForm({ type: 'chronometer', x: 1, y: 2, fontSize: 12, color: '#fff' });
      expect(html).toContain('⏱ Chronometer');
      expect(html).not.toContain('textarea');
      expect(html).not.toContain('edit-start');
      expect(html).not.toContain('edit-end');
    });

    it('escapes text in textarea', () => {
      const html = popup.buildEditForm({ type: 'text', text: '<b>&"test', x: 1, y: 2, fontSize: 12, color: '#fff' });
      expect(html).toContain('&lt;b&gt;&amp;&quot;test');
    });

    it('uses default values if fields are missing', () => {
      const html = popup.buildEditForm({ type: 'text' });
      expect(html).toContain('value="20"'); // x and y default
      expect(html).toContain('value="24"'); // fontSize default
      expect(html).toContain('value="#ffffff"'); // color default
    });
  });

  describe('setTitleBar', () => {
    let label, btn;
    beforeEach(() => {
      label = document.createElement('span');
      label.id = 'title-label';
      btn = document.createElement('button');
      btn.id = 'btn-save-preset';
      document.body.append(label, btn);
    });
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('sets label and enables button for valid titleId', () => {
      popup.setTitleBar('12345');
      expect(label.textContent).toBe('Title ID: 12345');
      expect(label.title).toBe('netflix.com/watch/12345');
      expect(btn.disabled).toBe(false);
    });

    it('sets label and disables button for null titleId', () => {
      popup.setTitleBar(null);
      expect(label.textContent).toBe('Not on a watch page');
      expect(label.title).toBe('');
      expect(btn.disabled).toBe(true);
    });
  });

  describe('updatePreview', () => {
    let dot, inputX, inputY, inputColor, inputText;
    beforeEach(() => {
      dot = document.createElement('div');
      dot.id = 'preview-dot';
      inputX = document.createElement('input');
      inputX.id = 'input-x';
      inputY = document.createElement('input');
      inputY.id = 'input-y';
      inputColor = document.createElement('input');
      inputColor.id = 'input-color';
      inputText = document.createElement('input');
      inputText.id = 'input-text';
      document.body.append(dot, inputX, inputY, inputColor, inputText);
    });
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('sets dot style and text from inputs', () => {
      inputX.value = '100';
      inputY.value = '200';
      inputColor.value = '#123456';
      inputText.value = 'Hello world!';
      popup.updatePreview();
      expect(dot.style.left).toBe(`${Math.round(100 * 160 / 1920)}px`);
      expect(dot.style.top).toBe(`${Math.round(200 * 160 / 1920)}px`);
      expect(dot.style.color).toBe('#123456');
      expect(dot.textContent).toBe('Hello world!');
    });

    it('uses defaults if inputs are empty', () => {
      inputX.value = '';
      inputY.value = '';
      inputColor.value = '';
      inputText.value = '';
      popup.updatePreview();
      expect(dot.style.left).toBe('0px');
      expect(dot.style.top).toBe('0px');
      expect(dot.style.color).toBe('#ffffff');
      expect(dot.textContent).toBe('…');
    });

    it('truncates text to 30 chars', () => {
      inputText.value = 'a'.repeat(40);
      popup.updatePreview();
      expect(dot.textContent.length).toBe(30);
    });

    it('does nothing if preview-dot is missing', () => {
      document.body.removeChild(dot);
      expect(() => popup.updatePreview()).not.toThrow();
    });
  });

  describe('getPresets and savePreset', () => {
    let origChrome, origTextEncoder, cb;
    beforeEach(() => {
      origChrome = global.chrome;
      origTextEncoder = global.TextEncoder;
      global.chrome = {
        storage: {
          sync: {
            get: jest.fn((key, cb) => cb({ [popup.PRESETS_KEY]: { foo: [1, 2] } })),
            set: jest.fn((payload, cb) => cb && cb()),
          },
        },
      };
      global.TextEncoder = class {
        encode(str) { return new Array(str.length).fill(0); }
      };
      cb = jest.fn();
    });
    afterEach(() => {
      global.chrome = origChrome;
      global.TextEncoder = origTextEncoder;
    });

    it('getPresets returns presets object', () => {
      popup.getPresets(cb);
      expect(cb).toHaveBeenCalledWith({ foo: [1, 2] });
    });

    it('getPresets returns empty object if not set', () => {
      global.chrome.storage.sync.get = (key, cb) => cb({});
      popup.getPresets(cb);
      expect(cb).toHaveBeenCalledWith({});
    });

    it('savePreset saves preset and calls callback', () => {
      popup.savePreset('bar', [3, 4], cb);
      expect(global.chrome.storage.sync.set).toHaveBeenCalled();
      expect(cb).toHaveBeenCalled();
    });

    it('shows quota warning if payload too large', () => {
      global.TextEncoder = class {
        encode() { return new Array(81921).fill(0); }
      };
      const warn = document.createElement('div');
      warn.id = 'quota-warning';
      warn.style.display = 'none';
      document.body.append(warn);
      popup.savePreset('baz', [5, 6], cb);
      expect(warn.style.display).toBe('');
      document.body.removeChild(warn);
    });

    it('does not throw if quota warning element missing', () => {
      global.TextEncoder = class {
        encode() { return new Array(81921).fill(0); }
      };
      expect(() => popup.savePreset('baz', [5, 6], cb)).not.toThrow();
    });
  });

  describe('pushLayers', () => {
    let origChrome;
    beforeEach(() => {
      origChrome = global.chrome;
      global.chrome = { runtime: { sendMessage: jest.fn() } };
      popup.layers = [{ foo: 1 }];
    });
    afterEach(() => {
      global.chrome = origChrome;
    });

    it('sends UPDATE_LAYERS message with layers', () => {
      popup.pushLayers();
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        target: 'content',
        type: 'UPDATE_LAYERS',
        layers: popup.layers,
      });
    });
  });
});
