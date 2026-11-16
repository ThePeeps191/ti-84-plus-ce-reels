// Raw link throughput with pipelined BLITs (no capture/quantize). usage: node tools/linkspeed.js [seconds]
const { CalcLink } = require('../src/calc-link');
const secs = Number(process.argv[2] || 6);
(async () => {
  const link = new CalcLink();
  link.start();
  await new Promise(r => link.once('connect', r));
  for (const bpp of [4, 8]) {
    link.setMode(bpp);
    const w = 136, h = 240, bytes = bpp === 4 ? w * h / 2 : w * h;
    const frames = [0x11, 0x99].map(v => Buffer.alloc(bytes, v));
    let acked = 0, sent = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      await link.waitForSlot();
      link.blit({ x: 92, y: 0, w, h, palStart: 0, palette: [], pixels: frames[sent++ & 1] }).then(ok => ok && acked++);
    }
    while (link.pendingAcks.length) await new Promise(r => setTimeout(r, 5));
    const dt = (Date.now() - t0) / 1000;
    console.log(`${bpp}bpp pipelined: ${(acked / dt).toFixed(1)} fps, ${(acked * bytes / dt / 1024).toFixed(0)} KiB/s`);
  }
  link.stop();
  process.exit(0);
})();
