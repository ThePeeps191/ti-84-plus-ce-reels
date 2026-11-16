// Starts (or reuses) the dedicated Chrome that shows Instagram Reels, and connects to it over CDP.
// Chrome is launched as a normal browser (not an automation build), with its own profile, so the
// login persists and Instagram sees an ordinary session.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.REELS_CDP_PORT || 9333);
const PROFILE = process.env.REELS_CHROME_PROFILE || path.join(process.env.LOCALAPPDATA || '.', 'ti84-reels', 'chrome-profile');
const REELS_URL = 'https://www.instagram.com/reels/';

function findChrome() {
  const candidates = [
    process.env.REELS_CHROME,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function cdpUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function launchChrome(log) {
  const exe = findChrome();
  if (!exe) throw new Error('Google Chrome not found (set REELS_CHROME to chrome.exe)');
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=460,900',
    '--autoplay-policy=no-user-gesture-required',
    // keep playing and rendering when the window is covered or in the background
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    REELS_URL,
  ];
  log(`launching Chrome (profile ${PROFILE})`);
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpUp()) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Chrome did not open its debugging port. If a "TI-84 Reels" Chrome window is already open without it, close that window and try again.');
}

// Returns { browser, page } for the Reels tab.
async function openReelsPage({ log = () => {} } = {}) {
  if (!(await cdpUp())) await launchChrome(log);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  let page = context.pages().find(p => /instagram\.com/.test(p.url()));
  if (!page) {
    page = context.pages()[0] || (await context.newPage());
    await page.goto(REELS_URL, { waitUntil: 'domcontentloaded' });
  }
  return { browser, page };
}

module.exports = { openReelsPage, PROFILE, PORT, REELS_URL };
