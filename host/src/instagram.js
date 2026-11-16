// Controls the Instagram Reels page (instagram.com/reels/) in the dedicated Chrome.
const { ensureHelpers } = require('./page-helpers');

const REELS_URL = 'https://www.instagram.com/reels/';

class Instagram {
  constructor(page, { log = () => {} } = {}) {
    this.page = page;
    this.log = log;
  }

  async _call(name, ...args) {
    await ensureHelpers(this.page);
    return this.page.evaluate(([n, a]) => window.__reels[n](...a), [name, args]);
  }

  // { loggedIn, url, id, hasVideo, paused, muted, username, likes, comments, liked }
  info() { return this._call('info'); }

  async _click(kind) {
    const pt = await this._call('point', kind);
    if (!pt) return false;
    await this.page.mouse.click(pt.x, pt.y);
    return true;
  }

  async _waitForReelChange(beforeId, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await this.page.waitForTimeout(100);
      const i = await this.info().catch(() => null);
      if (i && i.id && i.id !== beforeId) return i;
    }
    return null;
  }

  async _step(dir) {
    const before = await this.info();
    // A clicked control (e.g. the speaker button) keeps focus and swallows arrow keys.
    await this.page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    await this.page.keyboard.press(dir > 0 ? 'ArrowDown' : 'ArrowUp');
    let after = await this._waitForReelChange(before.id, 1500);
    if (!after && (await this._call('scrollNeighbour', dir))) after = await this._waitForReelChange(before.id, 2000);
    await this.ensureSound().catch(() => {});
    return after;
  }

  next() { return this._step(1); }
  prev() { return this._step(-1); }

  // Returns true if now playing.
  togglePause() { return this._call('togglePause'); }

  async toggleLike() {
    const ok = await this._click('like');
    if (!ok) this.log('like button not found');
    return ok;
  }

  // Repost / undo repost. If Instagram answers with a confirmation dialog or menu, pick its
  // "Repost"/"Remove"/"Undo" option; anything unexpected is logged and dismissed.
  async toggleRepost() {
    const before = await this.info();
    if (!(await this._click('repost'))) { this.log('repost button not found'); return false; }
    await this.page.waitForTimeout(700);
    const dlg = await this._call('dialog');
    if (dlg) {
      this.log(`repost opened a dialog: ${JSON.stringify(dlg)}`);
      const pattern = before.reposted ? '^(remove|undo|delete)' : '^repost$';
      const pt = await this._call('dialogButton', pattern);
      if (pt) await this.page.mouse.click(pt.x, pt.y);
      else await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    }
    const after = await this.info();
    this.log(`repost: ${before.reposted ? 'reposted' : 'not reposted'} -> ${after.reposted ? 'reposted' : 'not reposted'} (count ${before.reposts || '-'} -> ${after.reposts || '-'})`);
    return true;
  }

  // Instagram starts reels muted; click its speaker button once (the choice sticks for later reels).
  async ensureSound() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const i = await this.info();
      if (!i.hasVideo || !i.muted) return true;
      await this._click('mute');
      await this.page.waitForTimeout(300);
    }
    return !(await this.info()).muted;
  }

  async ensureReelsPage() {
    if (!/instagram\.com\/reels?\//.test(this.page.url())) {
      await this.page.goto(REELS_URL, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2500);
    }
  }

  // Base64 RGBA of the current video, cover-cropped to w x h, or null.
  async grab(w, h) {
    const b64 = await this._call('grab', w, h);
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
}

module.exports = { Instagram, REELS_URL };
