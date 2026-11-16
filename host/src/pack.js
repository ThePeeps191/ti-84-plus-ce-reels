// Pixel packing for the calculator LCD.

// Same bit layout as graphx gfx_RGBTo1555.
function rgbTo1555(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

// Pack palette indices (row-major, w*h) into LCD bytes, adding `offset` to each index.
// 4bpp: two pixels per byte, the left pixel in the low nibble. 8bpp: one byte per pixel.
function pack(indices, w, h, bpp, offset = 0) {
  if (bpp === 8) {
    const out = Buffer.allocUnsafe(w * h);
    for (let i = 0; i < w * h; i++) out[i] = indices[i] + offset;
    return out;
  }
  if (bpp !== 4) throw new RangeError('bpp must be 4 or 8');
  if (w % 2) throw new RangeError('4bpp width must be even');
  const out = Buffer.allocUnsafe((w * h) >> 1);
  for (let i = 0, o = 0; i < w * h; i += 2, o++) {
    out[o] = ((indices[i] + offset) & 15) | (((indices[i + 1] + offset) & 15) << 4);
  }
  return out;
}

module.exports = { rgbTo1555, pack };
