'use strict';

const {
  formatTime,
  getTitleIdFromUrl,
  getVisibleLayers,
  layerKey,
  migratePresets,
} = require('../src/lib/overlay-utils');

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
describe('formatTime', () => {
  test('formats 0 seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  test('formats 59 seconds as 00:59', () => {
    expect(formatTime(59)).toBe('00:59');
  });

  test('formats 60 seconds as 01:00', () => {
    expect(formatTime(60)).toBe('01:00');
  });

  test('formats 65 seconds as 01:05', () => {
    expect(formatTime(65)).toBe('01:05');
  });

  test('formats 3600 seconds as 60:00', () => {
    expect(formatTime(3600)).toBe('60:00');
  });

  test('floors fractional seconds', () => {
    expect(formatTime(61.9)).toBe('01:01');
  });
});

// ---------------------------------------------------------------------------
// getTitleIdFromUrl
// ---------------------------------------------------------------------------
describe('getTitleIdFromUrl', () => {
  test('extracts ID from /watch/<id>', () => {
    expect(getTitleIdFromUrl('/watch/80114790')).toBe('80114790');
  });

  test('extracts ID from /title/<id>', () => {
    expect(getTitleIdFromUrl('/title/80100172')).toBe('80100172');
  });

  test('extracts ID with query params present', () => {
    expect(getTitleIdFromUrl('/watch/80114790?trackId=284616272')).toBe('80114790');
  });

  test('returns null for unrelated path', () => {
    expect(getTitleIdFromUrl('/browse')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(getTitleIdFromUrl('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getVisibleLayers
// ---------------------------------------------------------------------------
describe('getVisibleLayers', () => {
  const staticLayer = { text: 'always visible' };
  const timedLayer = { text: 'timed', startTime: 10, endTime: 20 };
  const openEndLayer = { text: 'open end', startTime: 30 };
  const openStartLayer = { text: 'open start', endTime: 50 };
  const chrono = { type: 'chronometer' };

  test('static layer (no times) is always visible', () => {
    expect(getVisibleLayers([staticLayer], 0)).toHaveLength(1);
    expect(getVisibleLayers([staticLayer], null)).toHaveLength(1);
  });

  test('chronometer layer (no times) is always visible', () => {
    expect(getVisibleLayers([chrono], 0)).toHaveLength(1);
    expect(getVisibleLayers([chrono], null)).toHaveLength(1);
  });

  test('timed layer is hidden before startTime', () => {
    expect(getVisibleLayers([timedLayer], 9)).toHaveLength(0);
  });

  test('timed layer is visible at startTime boundary', () => {
    expect(getVisibleLayers([timedLayer], 10)).toHaveLength(1);
  });

  test('timed layer is visible within window', () => {
    expect(getVisibleLayers([timedLayer], 15)).toHaveLength(1);
  });

  test('timed layer is visible at endTime boundary', () => {
    expect(getVisibleLayers([timedLayer], 20)).toHaveLength(1);
  });

  test('timed layer is hidden after endTime', () => {
    expect(getVisibleLayers([timedLayer], 21)).toHaveLength(0);
  });

  test('timed layer with no video time (null) is hidden', () => {
    expect(getVisibleLayers([timedLayer], null)).toHaveLength(0);
  });

  test('open-end layer: visible from startTime onwards', () => {
    expect(getVisibleLayers([openEndLayer], 29)).toHaveLength(0);
    expect(getVisibleLayers([openEndLayer], 30)).toHaveLength(1);
    expect(getVisibleLayers([openEndLayer], 9999)).toHaveLength(1);
  });

  test('open-start layer: visible until endTime', () => {
    expect(getVisibleLayers([openStartLayer], 0)).toHaveLength(1);
    expect(getVisibleLayers([openStartLayer], 50)).toHaveLength(1);
    expect(getVisibleLayers([openStartLayer], 51)).toHaveLength(0);
  });

  test('mixed layers: correct subset returned', () => {
    const allLayers = [staticLayer, timedLayer, openEndLayer];
    const visible = getVisibleLayers(allLayers, 15);
    expect(visible).toContain(staticLayer);
    expect(visible).toContain(timedLayer);
    expect(visible).not.toContain(openEndLayer);
  });
});

// ---------------------------------------------------------------------------
// layerKey
// ---------------------------------------------------------------------------
describe('layerKey', () => {
  test('text layer key includes startTime, endTime, and text', () => {
    const layer = { text: 'hello', startTime: 5, endTime: 10 };
    expect(layerKey(layer, 7)).toBe('5-10-hello');
  });

  test('text layer without times uses empty strings', () => {
    const layer = { text: 'static' };
    expect(layerKey(layer, 0)).toBe('--static');
  });

  test('chronometer key changes each second', () => {
    const layer = { type: 'chronometer' };
    expect(layerKey(layer, 0)).toBe('chrono-0');
    expect(layerKey(layer, 0.9)).toBe('chrono-0');
    expect(layerKey(layer, 1.0)).toBe('chrono-1');
    expect(layerKey(layer, 60)).toBe('chrono-60');
  });

  test('chronometer key with null currentTime defaults to 0', () => {
    const layer = { type: 'chronometer' };
    expect(layerKey(layer, null)).toBe('chrono-0');
  });
});

// ---------------------------------------------------------------------------
// migratePresets
// ---------------------------------------------------------------------------
describe('migratePresets', () => {
  test('wraps a legacy flat-array preset in the named-preset format', () => {
    const layers = [{ text: 'hi', x: 1, y: 2 }];
    const { presets, didMigrate } = migratePresets({ '80100172': layers });
    expect(didMigrate).toBe(true);
    expect(presets['80100172'].Default.layers).toBe(layers);
    expect(typeof presets['80100172'].Default.created).toBe('number');
    expect(typeof presets['80100172'].Default.modified).toBe('number');
  });

  test('leaves already-named presets untouched', () => {
    const named = { '80100172': { Default: { layers: [], created: 1, modified: 2 } } };
    const { presets, didMigrate } = migratePresets(named);
    expect(didMigrate).toBe(false);
    expect(presets['80100172']).toEqual({ Default: { layers: [], created: 1, modified: 2 } });
  });

  test('migrates only the legacy titles in a mixed store', () => {
    const { presets, didMigrate } = migratePresets({
      legacy: [{ text: 'a' }],
      modern: { Custom: { layers: [], created: 1, modified: 1 } },
    });
    expect(didMigrate).toBe(true);
    expect(presets.legacy.Default.layers).toEqual([{ text: 'a' }]);
    expect(presets.modern).toEqual({ Custom: { layers: [], created: 1, modified: 1 } });
  });

  test('reports no migration for an empty store', () => {
    expect(migratePresets({}).didMigrate).toBe(false);
  });
});
