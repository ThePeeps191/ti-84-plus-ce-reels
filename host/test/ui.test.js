const test = require('node:test');
const assert = require('node:assert');
const { mapToPalette, uiPalette, PANEL_W, VIDEO_X, VIDEO_W, RIGHT_X } = require('../src/ui');

test('layout fills the 320px screen with even, 4bpp-aligned rectangles', () => {
  assert.strictEqual(PANEL_W, VIDEO_X);
  assert.strictEqual(VIDEO_X + VIDEO_W, RIGHT_X);
  assert.strictEqual(RIGHT_X + PANEL_W, 320);
  for (const v of [PANEL_W, VIDEO_X, VIDEO_W, RIGHT_X]) assert.strictEqual(v % 2, 0);
});

test('UI palettes fit the reserved index ranges', () => {
  assert.strictEqual(uiPalette(4).length, 4);
  assert.strictEqual(uiPalette(8).length, 16);
  assert.deepStrictEqual(uiPalette(8).slice(0, 4), uiPalette(4));
});

test('mapToPalette picks the nearest color', () => {
  const rgba = Buffer.from([0, 0, 0, 255, 250, 250, 250, 255, 120, 128, 135, 255, 220, 50, 60, 255]);
  assert.deepStrictEqual([...mapToPalette(rgba, uiPalette(4))], [0, 1, 2, 3]);
});
