// Dev helper: dump the DOM landmarks around the currently visible reel (for choosing selectors).
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('instagram.com'));
  console.log('url', page.url());
  const out = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('video')];
    let v = null, best = 0;
    for (const x of vids) { const r = x.getBoundingClientRect(); const vis = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)); if (vis > best) { best = vis; v = x; } }
    const vr = v.getBoundingClientRect();
    // climb until the ancestor contains an svg with aria-label Like/Unlike
    let c = v, depth = 0;
    while (c && !c.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')) { c = c.parentElement; depth++; }
    const res = { depth, videoRect: [vr.x, vr.y, vr.width, vr.height].map(Math.round), containerTag: c && c.tagName, svgs: [], links: [], texts: [] };
    if (!c) return res;
    for (const s of c.querySelectorAll('svg[aria-label]')) { const r = s.getBoundingClientRect(); res.svgs.push([s.getAttribute('aria-label'), Math.round(r.x), Math.round(r.y)]); }
    for (const a of c.querySelectorAll('a[href]')) { const r = a.getBoundingClientRect(); res.links.push([a.getAttribute('href'), (a.textContent || '').trim().slice(0, 40), Math.round(r.x), Math.round(r.y)]); }
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) { const t = n.textContent.trim(); if (t) { const r = n.parentElement.getBoundingClientRect(); res.texts.push([t.slice(0, 50), n.parentElement.tagName, Math.round(r.x), Math.round(r.y)]); } }
    res.buttons = [...c.querySelectorAll('[role=button],button')].map(b => [(b.getAttribute('aria-label') || '') , (b.textContent || '').trim().slice(0, 30), Math.round(b.getBoundingClientRect().x), Math.round(b.getBoundingClientRect().y)]).slice(0, 40);
    res.viewport = [innerWidth, innerHeight];
    res.scroller = (() => { let e = v; while (e && e !== document.body) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return { tag: e.tagName, scrollTop: e.scrollTop, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight }; e = e.parentElement; } return 'document'; })();
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
