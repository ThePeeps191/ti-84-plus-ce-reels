// Side panels drawn next to the video: username/status on the left, counts and key hints on the right.
// Text is rendered with a canvas in the browser page (real fonts, no font files here), then mapped to the
// small UI palette that both LCD modes reserve.

const PANEL_W = 92;
const PANEL_H = 240;
const LEFT_X = 0;
const VIDEO_X = 92;
const VIDEO_W = 136;
const RIGHT_X = 228;

// Index 0..3 identical in both modes; 8bpp adds grays for smoother text edges.
const UI_PALETTE_4 = [[0, 0, 0], [255, 255, 255], [130, 130, 130], [235, 45, 70]];
const UI_PALETTE_8 = [
  ...UI_PALETTE_4,
  [40, 40, 40], [70, 70, 70], [100, 100, 100], [165, 165, 165], [200, 200, 200], [225, 225, 225],
  [120, 25, 40], [180, 35, 55], [60, 160, 255], [255, 200, 60], [20, 20, 20], [90, 30, 40],
];

function uiPalette(bpp) {
  return bpp === 4 ? UI_PALETTE_4 : UI_PALETTE_8;
}

// Nearest-color mapping of RGBA pixels to palette indices.
function mapToPalette(rgba, palette) {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const c = palette[p];
        const d = 2 * (c[0] - r) ** 2 + 4 * (c[1] - g) ** 2 + 3 * (c[2] - b) ** 2;
        if (d < bd) { bd = d; idx = p; }
      }
      cache.set(key, idx);
    }
    out[i] = idx;
  }
  return out;
}

// Runs in the page. Draws both panels into one 184x240 canvas and returns base64 RGBA.
function pageRenderPanels(s) {
  const W = 92, H = 240;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, H);
  g.textBaseline = 'top';
  const WHITE = '#fff', GRAY = '#828282', RED = '#eb2d46';

  const wrap = (text, x, y, maxW, font, color, lineH, maxLines) => {
    g.font = font; g.fillStyle = color;
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    lines.slice(0, maxLines).forEach((l, i) => g.fillText(l, x, y + i * lineH));
    return y + Math.min(lines.length, maxLines) * lineH;
  };

  // ---- left panel ----
  g.font = 'bold 11px Arial'; g.fillStyle = RED; g.fillText('REELS', 4, 4);
  g.fillStyle = GRAY; g.font = '10px Arial'; g.fillText('TI-84 Plus CE', 4, 17);
  let y = 40;
  if (s.status) {
    y = wrap(s.status, 4, y, W - 8, 'bold 12px Arial', RED, 15, 6);
  } else if (s.username) {
    y = wrap('@' + s.username, 4, y, W - 8, 'bold 12px Arial', WHITE, 15, 4);
  }
  if (s.paused) { g.font = 'bold 12px Arial'; g.fillStyle = RED; g.fillText('PAUSED', 4, y + 10); }
  g.font = '10px Arial'; g.fillStyle = GRAY;
  g.fillText(s.bpp === 4 ? '16 colors' : '256 colors', 4, H - 14);

  // ---- right panel ----
  const ox = W;
  const heart = (cx, cy, size, filled) => {
    g.beginPath();
    const s2 = size / 2;
    g.moveTo(cx, cy + s2 * 0.9);
    g.bezierCurveTo(cx - size * 1.1, cy - s2 * 0.2, cx - s2 * 0.6, cy - size * 0.95, cx, cy - s2 * 0.35);
    g.bezierCurveTo(cx + s2 * 0.6, cy - size * 0.95, cx + size * 1.1, cy - s2 * 0.2, cx, cy + s2 * 0.9);
    g.closePath();
    if (filled) { g.fillStyle = RED; g.fill(); } else { g.strokeStyle = WHITE; g.lineWidth = 2; g.stroke(); }
  };
  const bubble = (cx, cy, r) => {
    g.beginPath(); g.arc(cx, cy, r, 0.25 * Math.PI, 2.05 * Math.PI);
    g.lineTo(cx + r + 1, cy + r + 1); g.closePath();
    g.strokeStyle = WHITE; g.lineWidth = 2; g.stroke();
  };
  // Two arrows chasing each other (Instagram's repost glyph), red when reposted.
  const repost = (cx, cy, on) => {
    g.strokeStyle = on ? RED : WHITE; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 8, cy + 2); g.lineTo(cx - 8, cy - 5); g.lineTo(cx + 6, cy - 5); g.stroke();
    g.beginPath(); g.moveTo(cx + 3, cy - 8); g.lineTo(cx + 7, cy - 5); g.lineTo(cx + 3, cy - 2); g.stroke();
    g.beginPath(); g.moveTo(cx + 8, cy - 2); g.lineTo(cx + 8, cy + 5); g.lineTo(cx - 6, cy + 5); g.stroke();
    g.beginPath(); g.moveTo(cx - 3, cy + 2); g.lineTo(cx - 7, cy + 5); g.lineTo(cx - 3, cy + 8); g.stroke();
  };
  heart(ox + 20, 22, 16, !!s.liked);
  g.font = 'bold 12px Arial'; g.fillStyle = s.liked ? RED : WHITE;
  g.fillText(s.likes || '-', ox + 36, 16);
  bubble(ox + 20, 56, 8);
  g.fillStyle = WHITE; g.fillText(s.comments || '-', ox + 36, 50);
  repost(ox + 20, 90, !!s.reposted);
  g.font = 'bold 12px Arial'; g.fillStyle = s.reposted ? RED : WHITE;
  g.fillText(s.reposts || '-', ox + 36, 84);

  const hints = [['▲', 'prev'], ['▼', 'next'], ['enter', 'pause'], ['2nd', 'like'], ['mode', 'repost'], ['alpha', 'colors'], ['clear', 'quit']];
  g.font = '10px Arial';
  hints.forEach(([k, v], i) => {
    const yy = 118 + i * 17;
    g.fillStyle = WHITE; g.fillText(k, ox + 4, yy);
    g.fillStyle = GRAY; g.fillText(v, ox + 42, yy);
  });

  const d = g.getImageData(0, 0, c.width, H).data;
  let out = '';
  for (let i = 0; i < d.length; i += 8192) out += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
  return btoa(out);
}

// Returns { left: {x, w, h, indices}, right: {...} } with indices into uiPalette(state.bpp).
async function renderPanels(page, state) {
  const b64 = await page.evaluate(pageRenderPanels, state);
  const rgba = Buffer.from(b64, 'base64');
  const W2 = PANEL_W * 2;
  const split = x0 => {
    const part = Buffer.alloc(PANEL_W * PANEL_H * 4);
    for (let y = 0; y < PANEL_H; y++) rgba.copy(part, y * PANEL_W * 4, (y * W2 + x0) * 4, (y * W2 + x0 + PANEL_W) * 4);
    return mapToPalette(part, uiPalette(state.bpp));
  };
  return {
    left: { x: LEFT_X, w: PANEL_W, h: PANEL_H, indices: split(0) },
    right: { x: RIGHT_X, w: PANEL_W, h: PANEL_H, indices: split(PANEL_W) },
  };
}

module.exports = { renderPanels, mapToPalette, uiPalette, UI_PALETTE_4, UI_PALETTE_8, PANEL_W, PANEL_H, LEFT_X, VIDEO_X, VIDEO_W, RIGHT_X };
