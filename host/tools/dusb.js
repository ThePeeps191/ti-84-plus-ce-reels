// Minimal TI DUSB client for the TI-84 Plus CE (USB 0451:E008 bound to WinUSB) over node-usb WebUSB.
// Talks to the calculator OS: info params, screenshots, remote key presses, silent variable transfer, dir listing.
// Protocol reference: tilibs (libticalcs) dusb_rpkt/dusb_vpkt/dusb_cmd.
const { WebUSB } = require('usb');
const zlib = require('zlib');
const fs = require('fs');

const RPKT = { BUF_SIZE_REQ: 1, BUF_SIZE_ALLOC: 2, VIRT_DATA: 3, VIRT_DATA_LAST: 4, VIRT_DATA_ACK: 5 };
const VPKT = { PING: 0x0001, PARM_REQ: 0x0007, PARM_DATA: 0x0008, DIR_REQ: 0x0009, VAR_HDR: 0x000A, RTS: 0x000B,
  VAR_REQ: 0x000C, VAR_CNTS: 0x000D, PARM_SET: 0x000E, MODIF_VAR: 0x0010, EXECUTE: 0x0011, MODE_SET: 0x0012,
  DATA_ACK: 0xAA00, DELAY_ACK: 0xBB00, EOT: 0xDD00, ERROR: 0xEE00 };
const PID = { PRODUCT_NUMBER: 1, PRODUCT_NAME: 2, MAIN_PART_ID: 3, HW_VERSION: 4, FULL_ID: 5, LANGUAGE_ID: 6,
  SUBLANG_ID: 7, DEVICE_TYPE: 8, BOOT_VERSION: 9, OS_MODE: 0x0A, OS_VERSION: 0x0B, PHYS_RAM: 0x0C,
  USER_RAM: 0x0D, FREE_RAM: 0x0E, PHYS_FLASH: 0x0F, USER_FLASH: 0x10, FREE_FLASH: 0x11, USER_PAGES: 0x12,
  FREE_PAGES: 0x13, LCD_WIDTH: 0x1E, LCD_HEIGHT: 0x1F, SCREENSHOT: 0x22, BATTERY: 0x2D, CLOCK_ON: 0x24 };

const be = (n, len) => { const a = []; for (let i = len - 1; i >= 0; i--) a.push((n >>> (8 * i)) & 0xff); return a; };
const rd = (b, o, len) => { let n = 0; for (let i = 0; i < len; i++) n = n * 256 + b[o + i]; return n; };

class Dusb {
  async open() {
    const usb = new WebUSB({ allowAllDevices: true });
    const devs = (await usb.getDevices()).filter(d => d.vendorId === 0x0451 && d.productId === 0xE008);
    if (!devs.length) throw new Error('TI-84 Plus CE (0451:E008) not found');
    this.dev = devs[0];
    await this.dev.open();
    await this.dev.selectConfiguration(this.dev.configuration.configurationValue);
    const itf = this.dev.configuration.interfaces[0];
    await this.dev.claimInterface(itf.interfaceNumber);
    this.epIn = itf.alternates[0].endpoints.find(e => e.direction === 'in').endpointNumber;
    this.epOut = itf.alternates[0].endpoints.find(e => e.direction === 'out').endpointNumber;
    await this.rawSend(RPKT.BUF_SIZE_REQ, be(1023, 4));
    const r = await this.rawRecv();
    if (r.type !== RPKT.BUF_SIZE_ALLOC) throw new Error('expected BUF_SIZE_ALLOC, got ' + r.type);
    this.bufSize = rd(r.data, 0, 4);
    return this;
  }
  async close() { try { await this.dev.close(); } catch (e) {} }
  async rawSend(type, data) {
    const pkt = new Uint8Array([...be(data.length, 4), type, ...data]);
    const r = await this.dev.transferOut(this.epOut, pkt);
    if (r.status !== 'ok') throw new Error('transferOut ' + r.status);
  }
  async rawRecv() {
    let buf = [];
    while (buf.length < 5 || buf.length < 5 + rd(buf, 0, 4)) {
      const r = await this.dev.transferIn(this.epIn, 2048);
      if (r.status !== 'ok') throw new Error('transferIn ' + r.status);
      buf = buf.concat([...new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)]);
    }
    const size = rd(buf, 0, 4);
    return { type: buf[4], data: buf.slice(5, 5 + size) };
  }
  async ack() { await this.rawSend(RPKT.VIRT_DATA_ACK, [0xE0, 0x00]); }
  async expectAck() {
    const r = await this.rawRecv();
    if (r.type !== RPKT.VIRT_DATA_ACK) throw new Error('expected raw ACK, got ' + r.type);
  }
  async vSend(vtype, data = []) {
    const full = [...be(data.length, 4), ...be(vtype, 2), ...data];
    const chunk = this.bufSize - 5;
    for (let o = 0; o < full.length; o += chunk) {
      const last = o + chunk >= full.length;
      await this.rawSend(last ? RPKT.VIRT_DATA_LAST : RPKT.VIRT_DATA, full.slice(o, o + chunk));
      await this.expectAck();
    }
  }
  async vRecv() {
    let first = null, data = [];
    for (;;) {
      const r = await this.rawRecv();
      if (r.type !== RPKT.VIRT_DATA && r.type !== RPKT.VIRT_DATA_LAST) throw new Error('unexpected raw type ' + r.type);
      await this.ack();
      if (!first) { first = { size: rd(r.data, 0, 4), type: rd(r.data, 4, 2) }; data = data.concat(r.data.slice(6)); }
      else data = data.concat(r.data);
      if (r.type === RPKT.VIRT_DATA_LAST) break;
    }
    if (first.type === VPKT.DELAY_ACK) return this.vRecv();
    return { type: first.type, size: first.size, data };
  }
  async expect(vtype) {
    const v = await this.vRecv();
    if (v.type !== vtype) throw new Error(`expected vpkt 0x${vtype.toString(16)}, got 0x${v.type.toString(16)} data=${v.data.slice(0, 16)}`);
    return v;
  }
  async modeSet() {
    await this.vSend(VPKT.PING, [0, 3, 0, 1, 0, 0, 0, 0, 0x07, 0xD0]);
    await this.expect(VPKT.MODE_SET);
  }
  async params(ids) {
    await this.vSend(VPKT.PARM_REQ, [...be(ids.length, 2), ...ids.flatMap(i => be(i, 2))]);
    const v = await this.expect(VPKT.PARM_DATA);
    const d = v.data, out = {};
    let o = 2;
    for (let k = 0; k < rd(d, 0, 2); k++) {
      const id = rd(d, o, 2); const ok = d[o + 2] === 0; o += 3;
      if (ok) { const len = rd(d, o, 2); o += 2; out[id] = d.slice(o, o + len); o += len; } else out[id] = null;
    }
    return out;
  }
  async screenshot() {
    await this.vSend(VPKT.PARM_REQ, [0, 1, ...be(PID.SCREENSHOT, 2)]);
    const v = await this.expect(VPKT.PARM_DATA);
    return v.data.slice(7); // count(2) id(2) ok(1) size16(2) then pixels
  }
  async key(code) {
    await this.vSend(VPKT.EXECUTE, [0, 0, 3, 0, code]);
    await this.expect(VPKT.DATA_ACK);
  }
  // List variables: [{name: Buffer, type, size, archived}]
  async dirList() {
    const aids = [1, 2, 3]; // size, type, archived
    await this.vSend(VPKT.DIR_REQ, [...be(aids.length, 4), ...aids.flatMap(a => be(a, 2)), 0, 1, 0, 1, 0, 1, 1]);
    const vars = [];
    for (;;) {
      const v = await this.vRecv();
      if (v.type === VPKT.EOT) break;
      if (v.type !== VPKT.VAR_HDR) throw new Error('unexpected vpkt 0x' + v.type.toString(16));
      const x = v.data; let o = 0;
      const nl = rd(x, o, 2); o += 2; const name = Buffer.from(x.slice(o, o + nl)); o += nl + 1;
      const na = rd(x, o, 2); o += 2; const attrs = {};
      for (let i = 0; i < na; i++) { const id = rd(x, o, 2); const ok = x[o + 2] === 0; o += 3; if (ok) { const l = rd(x, o, 2); o += 2; attrs[id] = rd(x, o, l); o += l; } }
      vars.push({ name, type: attrs[2] & 0xff, size: attrs[1], archived: !!attrs[3] });
    }
    return vars;
  }
  // Silent variable send. name: byte array, type: TI type id, data: byte array, archived: bool
  async sendVar(name, type, data, archived) {
    const attrs = [[2, be((0xF0070000 + type) >>> 0, 4)], [3, [archived ? 1 : 0]], [8, be(0, 4)]];
    await this.vSend(VPKT.RTS, [...be(name.length, 2), ...name, 0, ...be(data.length, 4), 1,
      ...be(attrs.length, 2), ...attrs.flatMap(([id, v]) => [...be(id, 2), ...be(v.length, 2), ...v])]);
    await this.expect(VPKT.DATA_ACK);
    await this.vSend(VPKT.VAR_CNTS, [...data]);
    await this.expect(VPKT.DATA_ACK);
    await this.vSend(VPKT.EOT, []);
  }
}

function png(path, w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const td = Buffer.concat([Buffer.from(t), d]); const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { rows[y * (w * 3 + 1)] = 0; rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

// RGB565 -> PNG. endian: 'le' or 'be'
function savePng565(path, px, w = 320, h = 240, endian = 'le') {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = endian === 'le' ? px[2 * i] | (px[2 * i + 1] << 8) : (px[2 * i] << 8) | px[2 * i + 1];
    rgb[3 * i] = ((v >> 11) & 31) * 255 / 31; rgb[3 * i + 1] = ((v >> 5) & 63) * 255 / 63; rgb[3 * i + 2] = (v & 31) * 255 / 31;
  }
  png(path, w, h, rgb);
}

// Key codes for EXECUTE/key (tilibs keys83p.h)
const KEY = { RIGHT: 0x01, LEFT: 0x02, UP: 0x03, DOWN: 0x04, ENTER: 0x05, CLEAR: 0x09, DEL: 0x0A, QUIT: 0x40, MODE: 0x45, PRGM: 0x2D, APPS: 0x2C, K0: 0x8E, K1: 0x8F };
const DUSB_ERR_BUSY = 0x36; // returned while a native program/shell owns the calculator

module.exports = { Dusb, VPKT, PID, KEY, DUSB_ERR_BUSY, savePng565, png, be, rd };
