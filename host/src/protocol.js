// Wire protocol shared with calc/src/proto.c.
// Frame: 0xA5, type u8, len u24 LE, payload[len].

const MAGIC = 0xA5;
const HEADER = 5;
const PROTO_VERSION = 1;

const T = {
  // host -> calc
  HELLO: 0x01,
  MODE: 0x10,
  BLIT: 0x12,
  DUMP: 0x20,
  QUIT: 0x30,
  // calc -> host
  C_HELLO: 0x81,
  ACK: 0x82,
  KEY: 0x83,
  BYE: 0x84,
  C_DUMP: 0x85,
};

const KEYS = { UP: 1, DOWN: 2, ENTER: 3, SECOND: 4, ALPHA: 5 };

function encode(type, payload = Buffer.alloc(0)) {
  const len = payload.length;
  if (len > 0xffffff) throw new RangeError('payload too large');
  const b = Buffer.allocUnsafe(HEADER + len);
  b[0] = MAGIC;
  b[1] = type;
  b[2] = len & 0xff;
  b[3] = (len >> 8) & 0xff;
  b[4] = (len >> 16) & 0xff;
  payload.copy(b, HEADER);
  return b;
}

class Decoder {
  constructor() {
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const out = [];
    for (;;) {
      const start = this.buf.indexOf(MAGIC);
      if (start < 0) { this.buf = Buffer.alloc(0); break; }
      if (start > 0) this.buf = this.buf.subarray(start);
      if (this.buf.length < HEADER) break;
      const len = this.buf[2] | (this.buf[3] << 8) | (this.buf[4] << 16);
      if (this.buf.length < HEADER + len) break;
      out.push({ type: this.buf[1], payload: Buffer.from(this.buf.subarray(HEADER, HEADER + len)) });
      this.buf = this.buf.subarray(HEADER + len);
    }
    return out;
  }
}

// BLIT payload: x u16, y u8, w u16, h u8, pal_start u8, pal_count u8, pal u16[pal_count], pixels
function blitPayload({ x, y, w, h, palStart = 0, palette = [], pixels }) {
  const n = palette.length;
  if (n > 255) throw new RangeError('palette chunk must be <= 255 entries');
  const head = Buffer.alloc(8 + 2 * n);
  head.writeUInt16LE(x, 0);
  head[2] = y;
  head.writeUInt16LE(w, 3);
  head[5] = h;
  head[6] = palStart;
  head[7] = n;
  for (let i = 0; i < n; i++) head.writeUInt16LE(palette[i], 8 + 2 * i);
  return Buffer.concat([head, pixels]);
}

module.exports = { MAGIC, PROTO_VERSION, T, KEYS, encode, Decoder, blitPayload };
