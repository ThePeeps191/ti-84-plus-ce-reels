// Logs key presses from the running REELS program. usage: node tools/keylisten.js [seconds]
const { CalcLink } = require('../src/calc-link');
const { KEYS } = require('../src/protocol');
const names = Object.fromEntries(Object.entries(KEYS).map(([n, c]) => [c, n]));
const link = new CalcLink({ log: m => console.log('[link]', m) });
link.on('key', k => console.log(new Date().toISOString().slice(11, 19), 'KEY', names[k] || k));
link.on('bye', () => { console.log('calculator quit'); process.exit(0); });
link.start();
setTimeout(() => process.exit(0), 1000 * Number(process.argv[2] || 180));
