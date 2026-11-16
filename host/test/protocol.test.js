const test = require('node:test');
const assert = require('node:assert');
const { encode, Decoder, T, blitPayload, KEYS } = require('../src/protocol');

test('encode produces magic, type, u24 LE length, payload', () => {
  const b = encode(T.MODE, Buffer.from([4]));
  assert.deepStrictEqual([...b], [0xA5, 0x10, 1, 0, 0, 4]);
});

test('round trip single message', () => {
  const d = new Decoder();
  const msgs = d.push(encode(T.KEY, Buffer.from([KEYS.DOWN])));
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].type, T.KEY);
  assert.deepStrictEqual([...msgs[0].payload], [2]);
});

test('message split across three chunks', () => {
  const d = new Decoder();
  const b = encode(T.ACK, Buffer.from([7]));
  assert.deepStrictEqual(d.push(b.subarray(0, 2)), []);
  assert.deepStrictEqual(d.push(b.subarray(2, 4)), []);
  const msgs = d.push(b.subarray(4));
  assert.strictEqual(msgs.length, 1);
  assert.deepStrictEqual([...msgs[0].payload], [7]);
});

test('two messages in one chunk, including empty payload', () => {
  const d = new Decoder();
  const msgs = d.push(Buffer.concat([encode(T.BYE), encode(T.KEY, Buffer.from([5]))]));
  assert.deepStrictEqual(msgs.map(m => m.type), [T.BYE, T.KEY]);
  assert.strictEqual(msgs[0].payload.length, 0);
});

test('garbage before magic is skipped', () => {
  const d = new Decoder();
  const msgs = d.push(Buffer.concat([Buffer.from([1, 2, 3]), encode(T.C_HELLO, Buffer.from([1, 4]))]));
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].type, T.C_HELLO);
});

test('large payload uses 24-bit length', () => {
  const payload = Buffer.alloc(70000, 0x5a);
  const b = encode(T.C_DUMP, payload);
  assert.deepStrictEqual([...b.subarray(2, 5)], [70000 & 255, (70000 >> 8) & 255, 70000 >> 16]);
  const d = new Decoder();
  const msgs = [];
  for (let i = 0; i < b.length; i += 4096) msgs.push(...d.push(b.subarray(i, i + 4096)));
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].payload.length, 70000);
});

test('blitPayload layout', () => {
  const p = blitPayload({ x: 300, y: 10, w: 2, h: 1, palStart: 4, palette: [0x7fff, 0x0001], pixels: Buffer.from([0xab]) });
  assert.deepStrictEqual([...p], [
    300 & 255, 300 >> 8, // x u16
    10,                  // y u8
    2, 0,                // w u16
    1,                   // h u8
    4, 2,                // pal_start, pal_count
    0xff, 0x7f, 0x01, 0x00, // palette u16 LE
    0xab,                // pixels
  ]);
});
