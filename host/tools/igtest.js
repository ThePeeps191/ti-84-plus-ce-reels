// Dev check of Instagram controls (does NOT like anything). usage: node tools/igtest.js
const { chromium } = require('playwright-core');
const { Instagram } = require('../src/instagram');
const { png } = require('./dusb');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('instagram.com'));
  const ig = new Instagram(page, { log: console.log });
  await ig.ensureReelsPage();
  const show = (label, i) => console.log(label.padEnd(10), JSON.stringify({ id: i && i.id, user: i && i.username, likes: i && i.likes, comments: i && i.comments, liked: i && i.liked, paused: i && i.paused, muted: i && i.muted }));
  show('start', await ig.info());
  await ig.ensureSound(); await page.waitForTimeout(500);
  show('sound', await ig.info());
  let t = Date.now(); const n = await ig.next(); console.log('next took', Date.now() - t, 'ms'); show('next', n || await ig.info());
  t = Date.now(); const n2 = await ig.next(); console.log('next took', Date.now() - t, 'ms'); show('next2', n2 || await ig.info());
  t = Date.now(); const p = await ig.prev(); console.log('prev took', Date.now() - t, 'ms'); show('prev', p || await ig.info());
  console.log('pause ->', await ig.togglePause()); await page.waitForTimeout(400); show('paused?', await ig.info());
  console.log('pause ->', await ig.togglePause()); await page.waitForTimeout(400); show('resumed?', await ig.info());
  t = Date.now(); const rgba = await ig.grab(136, 240); console.log('grab', rgba && rgba.length, 'bytes in', Date.now() - t, 'ms');
  if (rgba) { const rgb = Buffer.alloc(136 * 240 * 3); for (let i = 0; i < 136 * 240; i++) rgba.copy(rgb, 3 * i, 4 * i, 4 * i + 3); require('fs').mkdirSync('out', { recursive: true }); png('out/grab.png', 136, 240, rgb); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
