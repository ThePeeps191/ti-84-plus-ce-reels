// Hardware link test: with REELS running on the calculator, draw a text panel and stream real reel frames
// at 4bpp and 8bpp, measure fps, and save a DUMP readback as PNG.
// usage: node tools/linktest.js [seconds-per-mode]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { CalcLink } = require('../src/calc-link');
const { quantize } = require('../src/quantize');
const { pack, rgbTo1555 } = require('../src/pack');
const { png } = require('./dusb');

const OUT = path.join(__dirname, '..', 'out');
const secs = Number(process.argv[2] || 8);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function grab(page, w, h) {
  const b64 = await page.evaluate(([w, h]) => {
    const vids = [...document.querySelectorAll('video')];
    let v = null, best = 0;
    for (const x of vids) { const r = x.getBoundingClientRect(); const vis = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)); if (vis > best) { best = vis; v = x; } }
    if (!v || !v.videoWidth) return null;
    const c = window.__lt || (window.__lt = document.createElement('canvas')); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const vr = v.videoWidth / v.videoHeight, cr = w / h;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = sh * cr; sx = (v.videoWidth - sw) / 2; } else { sh = sw / cr; sy = (v.videoHeight - sh) / 2; }
    g.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
    return btoa(s);
  }, [w, h]);
  return b64 ? Buffer.from(b64, 'base64') : null;
}

async function textPanel(page, w, h, lines) {
  const b64 = await page.evaluate(([w, h, lines]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 13px Arial'; g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, 3, 4 + i * 18));
    const d = g.getImageData(0, 0, w, h).data;
    let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
    return btoa(s);
  }, [w, h, lines]);
  const rgba = Buffer.from(b64, 'base64');
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) idx[i] = rgba[4 * i] > 128 ? 1 : 0; // UI palette: 0 black, 1 white
  return idx;
}

function dumpToPng(d, file) {
  const rgb = Buffer.alloc(320 * 240 * 3);
  for (let i = 0; i < 320 * 240; i++) {
    const idx = d.bpp === 4 ? (i & 1 ? d.vram[i >> 1] >> 4 : d.vram[i >> 1] & 15) : d.vram[i];
    const c = d.palette[idx];
    rgb[3 * i] = ((c >> 10) & 31) * 255 / 31; rgb[3 * i + 1] = ((c >> 5) & 31) * 255 / 31; rgb[3 * i + 2] = (c & 31) * 255 / 31;
  }
  png(file, 320, 240, rgb);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('instagram.com'));
  if (!page) throw new Error('no Instagram page open in the CDP Chrome');

  const link = new CalcLink({ log: m => log('[link]', m) });
  link.start();
  await new Promise(r => link.once('connect', r));
  link.on('key', k => log('KEY from calculator:', k));

  for (const bpp of [4, 8]) {
    const uiN = bpp === 4 ? 4 : 16, vidN = bpp === 4 ? 12 : 240;
    link.setMode(bpp);
    const ui = [[0, 0, 0], [255, 255, 255], [130, 130, 130], [230, 40, 60]];
    const panel = await textPanel(page, 92, 240, [`${bpp}bpp test`, 'Is this text', 'sharp?', '', 'Press keys:', 'up/down/enter', '2nd / alpha']);
    await link.blit({ x: 0, y: 0, w: 92, h: 240, palStart: 0, palette: ui.map(c => rgbTo1555(...c)), pixels: pack(panel, 92, 240, bpp, 0) });
    let prev = null, frames = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      const rgba = await grab(page, 136, 240);
      if (!rgba) { await new Promise(r => setTimeout(r, 100)); continue; }
      const q = quantize(rgba, 136, 240, vidN, prev);
      prev = q.palette;
      const ok = await link.blit({ x: 92, y: 0, w: 136, h: 240, palStart: uiN, palette: q.palette.map(c => rgbTo1555(...c)), pixels: pack(q.indices, 136, 240, bpp, uiN) });
      if (!ok) { log('blit not acknowledged'); break; }
      frames++;
    }
    const dt = (Date.now() - t0) / 1000;
    log(`${bpp}bpp: ${frames} frames in ${dt.toFixed(1)} s = ${(frames / dt).toFixed(2)} fps`);
    const d = await link.dump();
    if (d) { const f = path.join(OUT, `dump_${bpp}bpp.png`); dumpToPng(d, f); log('dump saved', f, 'bpp', d.bpp); }
    else log('dump failed');
  }
  link.stop();
  await browser.close().catch(() => {});
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
