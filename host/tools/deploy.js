// Build the calculator program and send it to the TI-84 Plus CE over the OS link (DUSB).
//
// usage: node tools/deploy.js [--no-build] [--clibs <path/to/clibs.8xg>] [--no-launch]
//
// - Builds calc/ with the CE toolchain ($CEDEV, default %LOCALAPPDATA%\CEdev).
// - Waits while the calculator is busy (e.g. the arTIfiCE shell is open: press [mode] to leave it).
// - Sends REELS.8xp, plus clibs if any required library is missing (or --clibs is given).
// - Launches prgmA (arTIfiCE) with remote key presses; you then pick REELS and press [enter].
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { tifiles } = require('ticalc-usb');
const { Dusb, KEY } = require('./dusb');

const ROOT = path.resolve(__dirname, '..', '..');
const CALC = path.join(ROOT, 'calc');
const REQUIRED_LIBS = ['LibLoad', 'GRAPHX', 'KEYPADC', 'USBDRVCE', 'SRLDRVCE'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[deploy]', ...a);

function cedevDir() {
  return process.env.CEDEV || path.join(process.env.LOCALAPPDATA || '', 'CEdev');
}

function build() {
  const cedev = cedevDir();
  const make = path.join(cedev, 'bin', 'make.exe');
  if (!fs.existsSync(make)) throw new Error(`CE toolchain not found at ${cedev} (set CEDEV)`);
  log('building calc/ with', cedev);
  const env = { ...process.env, CEDEV: cedev, PATH: path.join(cedev, 'bin') + path.delimiter + process.env.PATH };
  execFileSync(make, [], { cwd: CALC, env, stdio: ['ignore', 'inherit', 'pipe'] });
}

async function withDusb(fn) {
  const d = await new Dusb().open();
  try { await d.modeSet(); return await fn(d); } finally { await d.close(); }
}

function entriesOf(file) {
  const f = tifiles.parseFile(new Uint8Array(fs.readFileSync(file)));
  if (!tifiles.isValid(f)) throw new Error('invalid TI file: ' + file);
  return f.entries;
}

async function sendEntries(d, entries) {
  for (const e of entries) {
    const name = [...e.name].map(c => c.charCodeAt(0));
    await d.sendVar(name, e.type, e.data, !!(e.attributes && e.attributes.archived));
    log('sent', e.name, `(${e.data.length} bytes)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const clibsIdx = args.indexOf('--clibs');
  const clibsPath = clibsIdx >= 0 ? args[clibsIdx + 1] : null;
  if (!args.includes('--no-build')) build();

  const prog = path.join(CALC, 'bin', 'REELS.8xp');
  if (!fs.existsSync(prog)) throw new Error('missing ' + prog);

  // The OS refuses transfers (DUSB error 0x36) while a native program or the arTIfiCE shell runs,
  // even though info/dir requests still work, so retry the actual send until it goes through.
  for (let attempt = 0; ; attempt++) {
    try {
      await withDusb(async d => {
        const have = new Set((await d.dirList()).map(v => v.name.toString('latin1')));
        const missing = REQUIRED_LIBS.filter(n => !have.has(n));
        if (missing.length && !clibsPath) throw new Error(`calculator is missing libraries ${missing.join(', ')}; rerun with --clibs <clibs.8xg>`);
        if (clibsPath) await sendEntries(d, entriesOf(clibsPath));
        await sendEntries(d, entriesOf(prog));
      });
      break;
    } catch (e) {
      if (/missing libraries/.test(e.message)) throw e;
      if (attempt === 0) log('calculator is busy or not connected — if the arTIfiCE shell is open, press [mode] on the calculator');
      await sleep(1500);
    }
  }

  if (!args.includes('--no-launch')) {
    await withDusb(async d => {
      for (const k of [KEY.CLEAR, KEY.PRGM, KEY.K1]) { await d.key(k); await sleep(400); }
      await d.key(KEY.ENTER);
    });
    log('launched the arTIfiCE shell — select REELS on the calculator and press [enter]');
  }
}

main().then(() => process.exit(0), e => { console.error('[deploy] ERROR', e.message || e); process.exit(1); });
