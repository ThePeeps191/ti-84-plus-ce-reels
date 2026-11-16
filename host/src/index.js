#!/usr/bin/env node
// TI-84 Plus CE Reels — laptop side. Run `npm start`, then launch REELS on the calculator.
const { App } = require('./app');

const log = msg => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);
const app = new App({ log });

process.on('SIGINT', async () => {
  log('stopping');
  await app.stop();
  process.exit(0);
});

app.start().catch(e => {
  log('fatal: ' + (e.stack || e.message));
  process.exit(1);
});
