// Adaptive palette + ordered dithering for tiny video frames.
//
// quantize(rgba, w, h, nColors, prevPalette?) -> { palette: [[r,g,b]...], indices: Uint8Array }
//  - palette: median cut, then a few k-means passes. When prevPalette is given it seeds k-means,
//    which keeps colors stable from frame to frame (less flicker).
//  - indices: 4x4 Bayer ordered dithering (temporally stable, unlike error diffusion).

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Histogram of 5-bit-per-channel colors: key = r5<<10 | g5<<5 | b5.
function histogram(rgba, n) {
  const counts = new Uint32Array(32768);
  const sums = new Float64Array(32768 * 3);
  for (let i = 0; i < n; i++) {
    const p = 4 * i;
    const k = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
    counts[k]++;
    sums[3 * k] += rgba[p]; sums[3 * k + 1] += rgba[p + 1]; sums[3 * k + 2] += rgba[p + 2];
  }
  const keys = [];
  // mean[k] = exact average color of the pixels in bin k
  const mean = new Float32Array(32768 * 3);
  for (let k = 0; k < 32768; k++) if (counts[k]) {
    keys.push(k);
    mean[3 * k] = sums[3 * k] / counts[k]; mean[3 * k + 1] = sums[3 * k + 1] / counts[k]; mean[3 * k + 2] = sums[3 * k + 2] / counts[k];
  }
  return { counts, keys, mean };
}

const kr = k => ((k >> 10) & 31) * 8 + 4;
const kg = k => ((k >> 5) & 31) * 8 + 4;
const kb = k => (k & 31) * 8 + 4;
const CH = [kr, kg, kb];

function medianCut(hist, nColors) {
  const boxes = [hist.keys.slice()];
  const stats = keys => {
    let best = 0, bestRange = -1, total = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const k of keys) { const v = CH[c](k); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > bestRange) { bestRange = hi - lo; best = c; }
    }
    for (const k of keys) total += hist.counts[k];
    return { ch: best, range: bestRange, total };
  };
  while (boxes.length < nColors) {
    let pick = -1, pickScore = 0, pickCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const s = stats(boxes[i]);
      const score = s.range * Math.sqrt(s.total);
      if (score > pickScore) { pickScore = score; pick = i; pickCh = s.ch; }
    }
    if (pick < 0) break;
    const box = boxes[pick].sort((a, b) => CH[pickCh](a) - CH[pickCh](b) || a - b);
    let half = 0, acc = 0;
    for (const k of box) half += hist.counts[k];
    half /= 2;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += hist.counts[box[i]]; if (acc >= half) { cut = i + 1; break; } }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, t = 0;
    for (const k of box) { const c = hist.counts[k], m = hist.mean; r += m[3 * k] * c; g += m[3 * k + 1] * c; b += m[3 * k + 2] * c; t += c; }
    return [r / t, g / t, b / t];
  });
}

function nearest(palette, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function kmeans(hist, palette, iterations, fallback) {
  let pal = palette.map(c => c.slice());
  for (let it = 0; it < iterations; it++) {
    const sum = pal.map(() => [0, 0, 0, 0]);
    for (const k of hist.keys) {
      const m = hist.mean, r = m[3 * k], g = m[3 * k + 1], b = m[3 * k + 2], c = hist.counts[k];
      const s = sum[nearest(pal, r, g, b)];
      s[0] += r * c; s[1] += g * c; s[2] += b * c; s[3] += c;
    }
    pal = sum.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : (fallback[i] || pal[i])));
  }
  return pal;
}

function dedupe(pal) {
  const seen = new Map();
  for (const c of pal) {
    const q = c.map(v => Math.max(0, Math.min(255, Math.round(v))));
    seen.set(q.join(','), q);
  }
  return [...seen.values()];
}

function quantize(rgba, w, h, nColors, prevPalette = null) {
  const n = w * h;
  const hist = histogram(rgba, n);
  const cut = medianCut(hist, Math.min(nColors, hist.keys.length));
  const seeds = prevPalette && prevPalette.length ? prevPalette.slice(0, nColors) : cut;
  const palette = dedupe(kmeans(hist, seeds, prevPalette ? 3 : 2, cut));

  // Ordered dithering. The spread shrinks as the palette grows.
  const spread = palette.length > 1 ? 0.6 * 255 / Math.cbrt(palette.length) : 0;
  const cache = new Int16Array(32768).fill(-1);
  const indices = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = 4 * i;
      const t = (BAYER4[((y & 3) << 2) | (x & 3)] / 16 - 0.469) * spread;
      const r = clamp(rgba[p] + t), g = clamp(rgba[p + 1] + t), b = clamp(rgba[p + 2] + t);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) { idx = nearest(palette, r, g, b); cache[key] = idx; }
      indices[i] = idx;
    }
  }
  return { palette, indices };
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

module.exports = { quantize };
