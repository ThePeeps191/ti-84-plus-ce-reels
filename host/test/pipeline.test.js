const test = require('node:test');
const assert = require('node:assert');
const { quantize } = require('../src/quantize');
const { pack, rgbTo1555 } = require('../src/pack');

function gradient(w, h) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    rgba[i] = (x * 255 / (w - 1)) | 0;
    rgba[i + 1] = (y * 255 / (h - 1)) | 0;
    rgba[i + 2] = ((x + y) * 255 / (w + h - 2)) | 0;
    rgba[i + 3] = 255;
  }
  return rgba;
}

test('quantize respects color budget and index range', () => {
  for (const n of [12, 240]) {
    const { palette, indices } = quantize(gradient(136, 240), 136, 240, n);
    assert.ok(palette.length <= n && palette.length > 1, `palette ${palette.length} for n=${n}`);
    assert.strictEqual(indices.length, 136 * 240);
    for (const i of indices) assert.ok(i < palette.length);
    for (const c of palette) for (const v of c) assert.ok(v >= 0 && v <= 255 && Number.isInteger(v));
  }
});

test('solid color image yields one effective color', () => {
  const rgba = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 200; rgba[i + 1] = 30; rgba[i + 2] = 90; rgba[i + 3] = 255; }
  const { palette, indices } = quantize(rgba, 16, 16, 12);
  const used = new Set(indices);
  assert.strictEqual(used.size, 1);
  const c = palette[[...used][0]];
  assert.ok(Math.abs(c[0] - 200) <= 2 && Math.abs(c[1] - 30) <= 2 && Math.abs(c[2] - 90) <= 2, `got ${c}`);
});

test('quantize is deterministic and accepts a previous palette', () => {
  const img = gradient(64, 64);
  const a = quantize(img, 64, 64, 12);
  const b = quantize(img, 64, 64, 12);
  assert.deepStrictEqual(a.palette, b.palette);
  assert.deepStrictEqual([...a.indices], [...b.indices]);
  const c = quantize(img, 64, 64, 12, a.palette);
  assert.ok(c.palette.length <= 12);
});

test('pack 4bpp puts left pixel in low nibble and applies offset', () => {
  const out = pack(Uint8Array.from([1, 2, 3, 4]), 4, 1, 4, 4);
  assert.deepStrictEqual([...out], [0x65, 0x87]);
});

test('pack 8bpp applies offset', () => {
  const out = pack(Uint8Array.from([0, 1, 239]), 3, 1, 8, 16);
  assert.deepStrictEqual([...out], [16, 17, 255]);
});

test('pack 4bpp rejects odd widths', () => {
  assert.throws(() => pack(Uint8Array.from([1, 2, 3]), 3, 1, 4, 0));
});

test('rgbTo1555 matches graphx gfx_RGBTo1555', () => {
  assert.strictEqual(rgbTo1555(255, 255, 255), 0x7fff);
  assert.strictEqual(rgbTo1555(0, 0, 0), 0);
  assert.strictEqual(rgbTo1555(255, 0, 0), 0x7c00);
  assert.strictEqual(rgbTo1555(0, 255, 0), 0x03e0);
  assert.strictEqual(rgbTo1555(0, 0, 255), 0x001f);
});
