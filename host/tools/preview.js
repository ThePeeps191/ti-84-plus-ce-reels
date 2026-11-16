// Renders what the calculator screen will show (panels + current reel) to out/preview_<bpp>.png.
const { chromium } = require('playwright-core');
const { Instagram } = require('../src/instagram');
const { renderPanels, uiPalette, VIDEO_X, VIDEO_W } = require('../src/ui');
const { quantize } = require('../src/quantize');
const { png } = require('./dusb');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('instagram.com'));
  const ig = new Instagram(page);
  const info = await ig.info();
  for (const bpp of [4, 8]) {
    const screen = Buffer.alloc(320 * 240 * 3);
    const ui = uiPalette(bpp);
    const panels = await renderPanels(page, { ...info, bpp, status: '' });
    for (const p of [panels.left, panels.right]) for (let y = 0; y < 240; y++) for (let x = 0; x < p.w; x++) { const c = ui[p.indices[y * p.w + x]]; const o = 3 * (y * 320 + p.x + x); screen[o] = c[0]; screen[o + 1] = c[1]; screen[o + 2] = c[2]; }
    const rgba = await ig.grab(VIDEO_W, 240);
    const q = quantize(rgba, VIDEO_W, 240, bpp === 4 ? 12 : 240);
    for (let y = 0; y < 240; y++) for (let x = 0; x < VIDEO_W; x++) { const c = q.palette[q.indices[y * VIDEO_W + x]]; const o = 3 * (y * 320 + VIDEO_X + x); screen[o] = c[0]; screen[o + 1] = c[1]; screen[o + 2] = c[2]; }
    png(`out/preview_${bpp}.png`, 320, 240, screen);
  }
  console.log(JSON.stringify(info));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
