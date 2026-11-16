// Saves out/quant.png: current reel frame | 12-color (4bpp) | 240-color (8bpp), each 136x240.
const { chromium } = require('playwright-core');
const { Instagram } = require('../src/instagram');
const { quantize } = require('../src/quantize');
const { png } = require('./dusb');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('instagram.com'));
  const ig = new Instagram(page);
  const w = 136, h = 240, W = w * 3;
  const rgba = await ig.grab(w, h);
  const out = Buffer.alloc(W * h * 3);
  const put = (col, getRGB) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = getRGB(y * w + x); const o = 3 * (y * W + col * w + x); out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } };
  put(0, i => [rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]]);
  for (const [col, n] of [[1, 12], [2, 240]]) { const t = Date.now(); const q = quantize(rgba, w, h, n); console.log(n, 'colors', Date.now() - t, 'ms'); put(col, i => q.palette[q.indices[i]]); }
  png(process.argv[2] || 'out/quant.png', W, h, out);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
