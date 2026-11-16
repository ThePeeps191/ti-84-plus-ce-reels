// Wires Chrome/Instagram, the frame pipeline and the calculator link together.
const { openReelsPage } = require('./chrome');
const { Instagram } = require('./instagram');
const { CalcLink } = require('./calc-link');
const { quantize } = require('./quantize');
const { pack, rgbTo1555 } = require('./pack');
const { renderPanels, uiPalette, VIDEO_X, VIDEO_W } = require('./ui');
const { KEYS } = require('./protocol');

const VIDEO_H = 240;
const MAX_FPS = 15;
const PAUSED_FPS = 2;
const INFO_POLL_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class App {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.bpp = 4;
    this.link = new CalcLink({ log: m => log('[calc] ' + m) });
    this.page = null;
    this.ig = null;
    this.info = null;
    this.userPaused = false;
    this.prevPalette = null;
    this.paletteReel = null;
    this.panelKey = '';
    this.status = '';
    this.actions = Promise.resolve();
    this.frames = 0;
    this.running = false;
  }

  async start() {
    this.running = true;
    await this._connectBrowser();
    this.link.on('connect', () => this._onCalcConnect());
    this.link.on('key', k => this._enqueue(() => this._onKey(k)));
    this.link.on('bye', () => this.log('calculator app closed — relaunch REELS on the calculator to continue'));
    this.link.start();
    this._infoLoop();
    this._frameLoop();
    this._statsLoop();
    this.log('waiting for the calculator: run prgmA, pick REELS, press [enter]');
  }

  async _connectBrowser() {
    for (;;) {
      try {
        const { browser, page } = await openReelsPage({ log: m => this.log('[chrome] ' + m) });
        this.page = page;
        this.ig = new Instagram(page, { log: m => this.log('[instagram] ' + m) });
        browser.on('disconnected', () => {
          this.log('[chrome] browser closed; reopening');
          this.page = null;
          this.ig = null;
          if (this.running) this._connectBrowser();
        });
        await this.ig.ensureReelsPage();
        await this.ig.ensureSound().catch(() => {});
        this.log('[chrome] connected to ' + page.url());
        return;
      } catch (e) {
        this.log('[chrome] ' + e.message);
        await sleep(3000);
      }
    }
  }

  _enqueue(fn) {
    this.actions = this.actions.then(fn).catch(e => this.log('action failed: ' + e.message));
  }

  async _onCalcConnect() {
    this.link.setMode(this.bpp);
    this.prevPalette = null;
    this.panelKey = '';
    await this._refreshPanels(true);
  }

  async _onKey(k) {
    if (!this.ig) return;
    switch (k) {
      case KEYS.DOWN: this.userPaused = false; this.info = (await this.ig.next()) || this.info; break;
      case KEYS.UP: this.userPaused = false; this.info = (await this.ig.prev()) || this.info; break;
      case KEYS.ENTER: this.userPaused = !(await this.ig.togglePause()); break;
      case KEYS.SECOND: await this.ig.toggleLike(); await sleep(400); break;
      case KEYS.MODE: await this.ig.toggleRepost(); break;
      case KEYS.ALPHA:
        this.bpp = this.bpp === 4 ? 8 : 4;
        this.log(`color mode: ${this.bpp === 4 ? '16 colors (smooth)' : '256 colors'}`);
        if (this.link.connected) { this.link.setMode(this.bpp); this.prevPalette = null; this.panelKey = ''; }
        break;
      default: return;
    }
    await this._pollInfo();
  }

  async _pollInfo() {
    if (!this.ig) return;
    try {
      const i = await this.ig.info();
      this.info = i;
      this.status = !i.loggedIn ? 'Log in to Instagram on the laptop' : !i.hasVideo ? 'Loading reels...' : '';
      // Instagram sometimes pauses on its own (e.g. focus changes); keep playing unless the user paused.
      if (i.hasVideo && i.paused && !this.userPaused) await this.ig.togglePause();
      // Instagram can re-mute (e.g. after scrolling or a reload); the laptop is the speaker, so keep sound on.
      if (i.hasVideo && i.muted) await this.ig.ensureSound();
      await this._refreshPanels(false);
    } catch (e) {
      this.log('[instagram] ' + e.message);
    }
  }

  async _infoLoop() {
    while (this.running) {
      await new Promise(r => { this._enqueue(async () => { await this._pollInfo(); r(); }); });
      await sleep(INFO_POLL_MS);
    }
  }

  async _refreshPanels(force) {
    if (!this.link.connected || !this.page) return;
    const i = this.info || {};
    const state = {
      bpp: this.bpp,
      username: i.username || '',
      likes: i.likes || '',
      comments: i.comments || '',
      reposts: i.reposts || '',
      liked: !!i.liked,
      reposted: !!i.reposted,
      paused: this.userPaused,
      status: this.status,
    };
    const key = JSON.stringify(state);
    if (!force && key === this.panelKey) return;
    this.panelKey = key;
    const panels = await renderPanels(this.page, state);
    const ui = uiPalette(this.bpp).map(c => rgbTo1555(...c));
    for (const p of [panels.left, panels.right]) {
      this.link.blit({ x: p.x, y: 0, w: p.w, h: p.h, palStart: 0, palette: ui, pixels: pack(p.indices, p.w, p.h, this.bpp, 0) });
    }
  }

  async _frameLoop() {
    let last = 0;
    while (this.running) {
      if (!this.link.connected || !this.ig) { await sleep(200); continue; }
      const minGap = 1000 / (this.userPaused ? PAUSED_FPS : MAX_FPS);
      const wait = last + minGap - Date.now();
      if (wait > 0) await sleep(wait);
      await this.link.waitForSlot();
      if (!this.link.connected) continue;
      last = Date.now();
      let rgba;
      try { rgba = await this.ig.grab(VIDEO_W, VIDEO_H); } catch { rgba = null; }
      if (!rgba) { await sleep(150); continue; }

      const bpp = this.bpp;
      const uiN = uiPalette(bpp).length;
      const reel = this.info && this.info.id;
      if (reel !== this.paletteReel) { this.prevPalette = null; this.paletteReel = reel; }
      const q = quantize(rgba, VIDEO_W, VIDEO_H, (bpp === 4 ? 16 : 256) - uiN, this.prevPalette);
      this.prevPalette = q.palette;
      this.link.blit({
        x: VIDEO_X, y: 0, w: VIDEO_W, h: VIDEO_H,
        palStart: uiN, palette: q.palette.map(c => rgbTo1555(...c)),
        pixels: pack(q.indices, VIDEO_W, VIDEO_H, bpp, uiN),
      }).then(ok => { if (ok) this.frames++; });
    }
  }

  async _statsLoop() {
    let lastFrames = 0, lastT = Date.now();
    while (this.running) {
      await sleep(5000);
      const now = Date.now();
      const fps = ((this.frames - lastFrames) * 1000) / (now - lastT);
      lastFrames = this.frames; lastT = now;
      if (this.link.connected) {
        const i = this.info || {};
        this.log(`streaming ${fps.toFixed(1)} fps, ${this.bpp === 4 ? '16' : '256'} colors | @${i.username || '?'} ♥${i.liked ? '(liked) ' : ''}${i.likes || '-'} ⟲${i.reposted ? '(reposted) ' : ''}${i.reposts || '-'}${this.userPaused ? ' | paused' : ''}`);
      }
    }
  }

  async stop() {
    this.running = false;
    this.link.stop();
  }
}

module.exports = { App };
