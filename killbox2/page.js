'use strict';
// VULKARN burns KITE's weapons: a four-panel manga page between phase 3 and the Ashen finale, which then burns away into the paper world.
// Render-only: the sim waits in hit-stop. Runs on rt. pageAt = the tick the page slams in (-1 = none).
const pageImg = n => { const i = new Image(); i.src = 'assets/out/' + n + '.webp'; return i; };
const FIST_IMG = pageImg('empty_fist'), DEATH_IMG = pageImg('ash_death'), SPEAR_IMG = pageImg('execute_spear');
const PAGE = { roar: 0, guns: 34, eyes: 112, fist: 146, burn: 206, end: 250 }; // ticks
let pageAt = -1, pageShot = null, pageSeen = false;
try { pageSeen = !!localStorage.getItem('killbox2.pageSeen'); } catch (_) { /* private window */ }
const pageOn = () => pageAt >= 0 && rt >= pageAt && rt < pageAt + PAGE.end;

function startPage() { // the whole finale entrance: page, then paper world, then the lives panel breaks
  pageShot = null;
  pageAt = rt + (cutin ? cutin.end - cutin.shot : 12);
  ashAt = pageAt + PAGE.burn - ASH_TURN - 10; // the paper world is ready under the page before it burns
  panelAt = pageAt + PAGE.end;
  hitstop = Math.max(hitstop, panelAt - rt + ASH_BREAK + 8);
}
function skipPage() { // any key or click, once the player has seen the page
  if (!pageSeen || !pageOn() || rt < pageAt + 20 || rt >= pageAt + PAGE.burn) return;
  const d = pageAt + PAGE.burn - rt; pageAt -= d; ashAt -= d; panelAt -= d; hitstop = Math.max(0, hitstop - d);
}
function pageCue() { // once per tick
  const t = rt - pageAt;
  if (pageAt < 0 || t < 0 || t > PAGE.end) return;
  if (t === PAGE.roar) { SFX.cutin(); SFX.roar(); shake = 24; }
  if (t === PAGE.guns) { SFX.cutin(); SFX.melt(); shake = 14; }
  if (t === PAGE.eyes) { SFX.cutin(); SFX.glint(); shake = 12; }
  if (t === PAGE.fist) { SFX.cutin(); SFX.clench(); shake = 20; }
  if (t === PAGE.burn) { SFX.burn(); if (!pageSeen) { pageSeen = true; try { localStorage.setItem('killbox2.pageSeen', '1'); } catch (_) { /* not saved */ } } }
}
function pagePanel(t, pts, bg, fn) { // slams in with overshoot, then holds
  if (t < 0) return;
  const k = Math.min(1, t / 6), z = 1 + 0.35 * (1 - k) ** 2, cx = pts.reduce((m, p) => m + p[0], 0) / pts.length, cy = pts.reduce((m, p) => m + p[1], 0) / pts.length;
  ctx.save(); ctx.globalAlpha = Math.min(1, t / 3 + 0.2); ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy);
  const path = new Path2D(); pts.forEach(p => path.lineTo(...p)); path.closePath();
  ctx.save(); ctx.clip(path); ctx.fillStyle = bg; ctx.fillRect(0, 0, KB.W, KB.H); fn(t); ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.lineJoin = 'miter'; ctx.stroke(path); ctx.restore();
}
const HOT_GUN = new Map(); // glowing silhouettes of the guns
function hotGun(im) {
  if (HOT_GUN.has(im)) return HOT_GUN.get(im);
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const o = c.getContext('2d'); o.drawImage(im, 0, 0); o.globalCompositeOperation = 'source-in';
  const g = o.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, EMBER); g.addColorStop(1, AMBER); o.fillStyle = g; o.fillRect(0, 0, c.width, c.height);
  HOT_GUN.set(im, c); return c;
}
function meltGun(im, cx, cy, w, m, seed) { // m 0 cold .. 1 slag: it glows, sags, then runs out of the panel
  if (m > 2.2) return;
  if (!im.complete || !im.naturalWidth) return;
  const n = 36, sw = im.naturalWidth / n, dw = w / n, h = w * im.naturalHeight / im.naturalWidth, hot = hotGun(im), heat = Math.min(1, m * 2.2), run = Math.max(0, (Math.min(1, m) - 0.3) / 0.7), gone = Math.max(0, m - 1) ** 2 * 260;
  for (let i = 0; i < n; i++) {
    const v = 0.55 + 0.45 * Math.sin(i * 0.7 + seed) + 0.5 * fxRnd(seed, i >> 1), sag = run * run * 150 * v, x = cx - w / 2 + i * dw, y = cy - h / 2 + sag * 0.7 + gone * v, hh = h + sag;
    ctx.globalAlpha = 1; ctx.drawImage(im, i * sw, 0, sw, im.naturalHeight, x, y, dw + 0.6, hh);
    ctx.globalAlpha = heat * 0.9; ctx.drawImage(hot, i * sw, 0, sw, im.naturalHeight, x, y, dw + 0.6, hh);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { // drops
    const u = run * 1.6 - fxRnd(seed + 3, i) * 0.7; if (u <= 0) continue;
    const x = cx + (fxRnd(seed + 5, i) - 0.5) * w * 0.9, y = cy + h * 0.3 + u * u * 190, r = 3 + 3 * fxRnd(seed + 7, i);
    ctx.beginPath(); ctx.moveTo(x, y - r * 4); ctx.quadraticCurveTo(x + r * 1.4, y, x, y + r); ctx.quadraticCurveTo(x - r * 1.4, y, x, y - r * 4); inked(AMBER, 1.5);
  }
}
function drawPagePanels(t) {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, KB.W, KB.H);
  pagePanel(t - PAGE.roar, [[18, 16], [560, 16], [500, 262], [18, 262]], '#1c060d', u => { // he roars
    glow(330, 190, 420, EMBER, 0.75);
    for (let i = 0; i < 26; i++) { const a = i / 26 * 6.28 + fxRnd(81, i), r0 = 150 + 60 * fxRnd(82, i); ctx.save(); ctx.translate(330, 150); ctx.rotate(a); ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(520, -9); ctx.lineTo(520, 9); ctx.fill(); ctx.restore(); }
    const im = BAND_IMG[2], j = Math.max(0, 1 - u / 30) * 8 * cfg.shake / 100;
    if (im.naturalWidth) ctx.drawImage(im, 8 + (Math.random() - 0.5) * j, 18 - u * 0.06 + (Math.random() - 0.5) * j, 470 + u * 0.1, (470 + u * 0.1) * 640 / 1172);
  });
  pagePanel(t - PAGE.guns, [[576, 16], [942, 16], [942, 262], [516, 262]], '#2a0f16', u => { // every gun he carried
    glow(740, 262, 300, EMBER, 0.5);
    const guns = s.players[0].guns.slice(0, 3), n = guns.length, w = n > 2 ? 130 : n > 1 ? 165 : 230;
    guns.forEach((g, i) => { const im = g.id === 'pistol' ? IMG.gun : PICK_IMG[g.id]; if (im) meltGun(im, 742 + (i % 2 ? 60 : n > 1 ? -60 : 0), n > 1 ? 75 + i * (n > 2 ? 64 : 92) : 120, g.id === 'pistol' && n > 1 ? w * 0.72 : w, Math.max(0, (u - 14 - i * 6) / 62), i * 13 + 4); });
  });
  pagePanel(t - PAGE.eyes, [[18, 278], [420, 278], [390, 524], [18, 524]], '#5a0d1c', u => { // KITE watches it
    const im = CUT_IMG[0], W = im.naturalWidth; if (!W) return;
    glow(210, 520, 320, EMBER, 0.7);
    const z = 1 + u * 0.0006, dw = 412 * z, dh = 253 * z;
    ctx.drawImage(im, W * 0.3, W * 0.115, W * 0.4, W * 0.4 * 253 / 412, 212 - dw / 2, 401 - dh / 2, dw, dh);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(300, 540, 260, EMBER, 0.35 + 0.1 * Math.sin(t / 4)); ctx.restore();
  });
  pagePanel(t - PAGE.fist, [[436, 278], [942, 278], [942, 524], [406, 524]], PAPER, u => { // and is not finished
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.28 + 0.1 * fxRnd(91, i), r0 = 165 + 70 * fxRnd(92, i); ctx.save(); ctx.translate(690, 390); ctx.rotate(a); ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo(600, -5); ctx.lineTo(600, 5); ctx.fill(); ctx.restore(); }
    const j = u < 34 ? 2.5 * cfg.shake / 100 : 0, d = 440;
    if (FIST_IMG.naturalWidth) ctx.drawImage(FIST_IMG, 448 + (Math.random() - 0.5) * j, 254 + (Math.random() - 0.5) * j, d, d);
  });
}
function burnBlobs(c, k, grow) { // holes that eat in from the edges
  c.beginPath();
  for (let i = 0; i < 280; i++) {
    const x = (i % 20 + fxRnd(61, i)) * 48, y = ((i / 20 | 0) + fxRnd(62, i)) * 39, edge = Math.min(x, 960 - x, (y) * 1.6, (540 - y) * 1.6) / 480;
    const u = (k * 1.1 - edge * 0.7 - fxRnd(63, i) * 0.3) / 0.35; if (u <= 0) continue;
    const r = Math.min(1, u) * 78 + grow; c.moveTo(x + r, y); c.arc(x, y, r, 0, 7);
  }
  c.fill();
}
function drawPage() { // screen space, over everything
  if (!pageOn()) return;
  const t = rt - pageAt;
  ctx.save(); ctx.setTransform(RS, 0, 0, RS, 0, 0);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 0.5 * cfg.shake / 100, (Math.random() - 0.5) * shake * 0.5 * cfg.shake / 100);
  if (t < PAGE.burn || !pageShot) {
    ctx.fillStyle = PAPER; ctx.fillRect(-20, -20, KB.W + 40, KB.H + 40); drawPagePanels(Math.min(t, PAGE.burn));
    pageShot = null;
    if (t >= PAGE.burn) { pageShot = document.createElement('canvas'); pageShot.width = cv.width; pageShot.height = cv.height; pageShot.getContext('2d').drawImage(cv, 0, 0); }
  } else {
    const o = document.createElement('canvas'), k = (t - PAGE.burn) / (PAGE.end - PAGE.burn); o.width = pageShot.width; o.height = pageShot.height;
    const c = o.getContext('2d'); c.drawImage(pageShot, 0, 0); c.setTransform(o.width / KB.W, 0, 0, o.height / KB.H, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    for (const [col, g] of [['#2b1a12', 26], [EMBER, 10], [HOT, 4]]) { c.fillStyle = col; burnBlobs(c, k, g); } // char, ember, white-hot lip
    c.globalCompositeOperation = 'destination-out'; burnBlobs(c, k, 0);
    ctx.drawImage(o, 0, 0, KB.W, KB.H);
  }
  ctx.restore();
}
