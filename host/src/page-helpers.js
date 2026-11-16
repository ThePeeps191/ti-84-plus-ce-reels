// Helpers installed into the Instagram page as window.__reels.
// Installed by evaluating this function through CDP, so Instagram's CSP (no eval) does not apply.
// Selectors are structural (aria-labels, hrefs, positions); Instagram's class names change often.

const HELPERS_VERSION = 3;

function installHelpers(version) {
  if (window.__reels && window.__reels.version === version) return;

  // The reel whose <video> covers the most of the viewport, and the container holding its buttons.
  const locate = () => {
    let video = null, best = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const vis = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) * (r.width > 0 ? 1 : 0);
      if (vis > best) { best = vis; video = v; }
    }
    if (!video) return null;
    let container = video;
    while (container && !container.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')) container = container.parentElement;
    return { video, container };
  };

  const icon = (c, label) => c.querySelector(`svg[aria-label="${label}"]`);

  const info = () => {
    const loggedIn = !location.pathname.startsWith('/accounts/login') && !document.querySelector('input[name="password"]');
    const found = locate();
    const res = { loggedIn, url: location.href, id: '', hasVideo: !!found, paused: false, muted: false, username: '', likes: '', comments: '', liked: false };
    if (!found) return res;
    const { video, container } = found;
    res.id = (location.pathname.match(/\/reels?\/([^/]+)/) || [])[1] || video.currentSrc;
    res.paused = video.paused;
    res.muted = video.muted;
    if (!container) return res;
    const userLink = [...container.querySelectorAll('a[href$="/reels/"]')].find(a => a.textContent.trim());
    if (userLink) res.username = userLink.textContent.trim();
    const likeSvg = icon(container, 'Unlike') || icon(container, 'Like');
    res.liked = !!icon(container, 'Unlike');
    const numeric = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const t = n.textContent.trim();
      if (/^[\d.,]+\s*[KMB]?$/i.test(t)) numeric.push({ t, y: n.parentElement.getBoundingClientRect().top });
    }
    // A count is the numeric label just below its icon (and above the next icon).
    const below = (a, b) => {
      if (!a) return '';
      const ya = a.getBoundingClientRect().top;
      const yb = b ? b.getBoundingClientRect().top : ya + 60;
      const hit = numeric.find(x => x.y > ya && x.y < yb);
      return hit ? hit.t : '';
    };
    const commentSvg = icon(container, 'Comment');
    res.likes = below(likeSvg, commentSvg);
    res.comments = below(commentSvg, icon(container, 'Repost') || icon(container, 'Share'));
    return res;
  };

  // Screen point (CSS px) of a control of the current reel: 'like' | 'mute'.
  const point = kind => {
    const found = locate();
    if (!found || !found.container) return null;
    const c = found.container;
    let s = null;
    if (kind === 'like') s = icon(c, 'Unlike') || icon(c, 'Like');
    if (kind === 'mute') s = icon(c, 'Audio is muted');
    if (!s) return null;
    const el = s.closest('[role=button],button') || s;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const togglePause = () => {
    const found = locate();
    if (!found) return null;
    const v = found.video;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    return !v.paused;
  };

  // Scroll the neighbouring reel into view (fallback when arrow keys do nothing).
  const scrollNeighbour = d => {
    const found = locate();
    if (!found) return false;
    const vids = [...document.querySelectorAll('video')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const target = vids[vids.indexOf(found.video) + d];
    if (!target) return false;
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  };

  // Cover-crop the current video into a w x h canvas; returns base64 RGBA or null.
  let canvas = null;
  const grab = (w, h) => {
    const found = locate();
    if (!found) return null;
    const v = found.video;
    if (!v.videoWidth || v.readyState < 2) return null;
    if (!canvas) canvas = document.createElement('canvas');
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const vr = v.videoWidth / v.videoHeight, cr = w / h;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = sh * cr; sx = (v.videoWidth - sw) / 2; } else { sh = sw / cr; sy = (v.videoHeight - sh) / 2; }
    g.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let s = '';
    for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
    return btoa(s);
  };

  window.__reels = { version, locate, info, point, togglePause, scrollNeighbour, grab };
}

async function ensureHelpers(page) {
  await page.evaluate(installHelpers, HELPERS_VERSION);
}

module.exports = { ensureHelpers, HELPERS_VERSION };
