// USB serial link to the REELS calculator program.
// Finds the calculator's CDC COM port, handshakes, pushes BLITs with ACK flow control,
// and reports key presses. Reconnects automatically.
const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');
const { T, PROTO_VERSION, encode, Decoder, blitPayload } = require('./protocol');

const CALC_VID = '16c0';
const CALC_PID = '05e1';
const MAX_IN_FLIGHT = 2;
const ACK_TIMEOUT_MS = 3000;

async function findCalcPort() {
  const ports = await SerialPort.list();
  return ports.find(p => (p.vendorId || '').toLowerCase() === CALC_VID && (p.productId || '').toLowerCase() === CALC_PID) || null;
}

class CalcLink extends EventEmitter {
  constructor({ log = () => {} } = {}) {
    super();
    this.log = log;
    this.port = null;
    this.connected = false;
    this.bpp = 8;
    this.decoder = new Decoder();
    this.pendingAcks = [];
    this.slotWaiters = [];
    this.waiters = new Map(); // msg type -> [resolve]
    this.stopped = true;
    this.timer = null;
  }

  start() {
    this.stopped = false;
    this._schedule(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.port && this.port.isOpen) this.port.close(() => {});
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => this._tryConnect().catch(e => this.log('link error: ' + e.message)), ms);
  }

  async _tryConnect() {
    if (this.port) return;
    const info = await findCalcPort();
    if (!info) return this._schedule(1000);
    this.log(`calculator found on ${info.path}`);
    const port = new SerialPort({ path: info.path, baudRate: 115200, autoOpen: false });
    try {
      await new Promise((res, rej) => port.open(err => (err ? rej(err) : res())));
    } catch (e) {
      this.log(`could not open ${info.path}: ${e.message}`);
      return this._schedule(1500);
    }
    this.port = port;
    this.decoder = new Decoder();
    port.on('data', chunk => this._onData(chunk));
    port.on('close', () => this._onClose());
    port.on('error', e => this.log('serial error: ' + e.message));

    for (let attempt = 0; attempt < 5 && this.port === port; attempt++) {
      this._write(encode(T.HELLO, Buffer.from([PROTO_VERSION])));
      const hello = await this._waitFor(T.C_HELLO, 1500);
      if (hello) {
        this.bpp = hello[1];
        this.connected = true;
        this.log(`calculator says hello (protocol ${hello[0]}, ${this.bpp}bpp)`);
        if (hello[0] !== PROTO_VERSION) this.log(`WARNING: calculator program speaks protocol ${hello[0]}, this app expects ${PROTO_VERSION}; reinstall it with npm run deploy`);
        this.emit('connect', { bpp: this.bpp });
        return;
      }
    }
    this.log('no reply from calculator; is REELS running?');
    port.close(() => {});
  }

  _onClose() {
    const was = this.connected;
    this.port = null;
    this.connected = false;
    for (const p of this.pendingAcks.splice(0)) { clearTimeout(p.timer); p.resolve(false); }
    for (const w of this.slotWaiters.splice(0)) w();
    for (const [, list] of this.waiters) for (const r of list) r(null);
    this.waiters.clear();
    if (was) { this.log('calculator disconnected'); this.emit('disconnect'); }
    this._schedule(1000);
  }

  _onData(chunk) {
    for (const m of this.decoder.push(chunk)) {
      switch (m.type) {
        case T.ACK: {
          const p = this.pendingAcks.shift();
          if (p) { clearTimeout(p.timer); p.resolve(true); }
          const w = this.slotWaiters.shift();
          if (w) w();
          break;
        }
        case T.KEY: this.emit('key', m.payload[0]); break;
        case T.BYE: this.log('calculator quit'); this.emit('bye'); break;
        default: {
          const list = this.waiters.get(m.type);
          if (list && list.length) list.shift()(m.payload);
        }
      }
    }
  }

  _waitFor(type, timeoutMs) {
    return new Promise(resolve => {
      const list = this.waiters.get(type) || [];
      const done = v => { clearTimeout(t); const i = list.indexOf(done); if (i >= 0) list.splice(i, 1); resolve(v); };
      const t = setTimeout(() => done(null), timeoutMs);
      list.push(done);
      this.waiters.set(type, list);
    });
  }

  _write(buf) {
    if (!this.port) return false;
    this.port.write(buf);
    return true;
  }

  setMode(bpp) {
    this.bpp = bpp;
    return this._write(encode(T.MODE, Buffer.from([bpp])));
  }

  // Resolves once fewer than MAX_IN_FLIGHT BLITs are unacknowledged (or the link drops).
  async waitForSlot() {
    while (this.connected && this.pendingAcks.length >= MAX_IN_FLIGHT) {
      await new Promise(r => this.slotWaiters.push(r));
    }
  }

  // Resolves true when the calculator has applied the BLIT, false on timeout/disconnect.
  async blit(rect) {
    await this.waitForSlot();
    if (!this.connected) return false;
    return new Promise(resolve => {
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        const i = this.pendingAcks.indexOf(entry);
        if (i >= 0) this.pendingAcks.splice(i, 1);
        const w = this.slotWaiters.shift();
        if (w) w();
        resolve(false);
      }, ACK_TIMEOUT_MS);
      this.pendingAcks.push(entry);
      this._write(encode(T.BLIT, blitPayload(rect)));
    });
  }

  // Debug readback of the calculator framebuffer.
  async dump(timeoutMs = 10000) {
    const p = this._waitFor(T.C_DUMP, timeoutMs);
    this._write(encode(T.DUMP));
    const d = await p;
    if (!d) return null;
    const bpp = d[0];
    const palette = new Uint16Array(256);
    for (let i = 0; i < 256; i++) palette[i] = d.readUInt16LE(1 + 2 * i);
    return { bpp, palette, vram: d.subarray(513) };
  }

  quit() {
    return this._write(encode(T.QUIT));
  }
}

module.exports = { CalcLink, findCalcPort };
