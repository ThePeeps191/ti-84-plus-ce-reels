// Logs key presses from the running REELS program. usage: node tools/keylisten.js [seconds]
const { CalcLink } = require('../src/calc-link');
const names = { 1: 'UP', 2: 'DOWN', 3: 'ENTER', 4: '2ND', 5: 'ALPHA' };
const link = new CalcLink({ log: m => console.log('[link]', m) });
link.on('key', k => console.log(new Date().toISOString().slice(11, 19), 'KEY', names[k] || k));
link.on('bye', () => { console.log('calculator quit'); process.exit(0); });
link.start();
setTimeout(() => process.exit(0), 1000 * Number(process.argv[2] || 180));
