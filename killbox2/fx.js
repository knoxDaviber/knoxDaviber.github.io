'use strict';
// Projectiles and hit FX, drawn as inked vectors (docs/art/environment.md). Render-only: reads sim state, never changes it.
// Everything ages on rt (60 Hz ticks), so FX keep playing through hit-stop and run at the same speed on any monitor.
const INK = '#0b0a0f', STEEL = '#9aa1b2', HOT = '#fff1a8';
const FX_LIFE = { muzzle: 5, spark: 8, clank: 8, splat: 18, parry: 22, perfect: 18, stagger: 24, execute: 26, firework: 26, ring: 18 };
let fxs = [], partsAt = 0;
const fxRnd = (seed, i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
function fxAdd(k, x, y, o) { fxs.push({ k, x, y, a: 0, r: 20, col: PAPER, at: rt, seed: Math.random() * 99, ...o }); }
function fxClear() { fxs = []; cutin = null; band = null; partsAt = rt; }

function inked(fill, line = 2) { ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = line * 2; ctx.stroke(); ctx.fillStyle = fill; ctx.fill(); }
function starPath(n, out, inn, seed) { // spikes of uneven length, centred on the origin
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = i / n * Math.PI, r = i % 2 ? inn : out * (0.6 + 0.4 * fxRnd(seed, i)); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath();
}
function dartPath(r0, r1, w) { ctx.beginPath(); ctx.moveTo(r0, 0); ctx.lineTo((r0 + r1) / 2, -w); ctx.lineTo(r1, 0); ctx.lineTo((r0 + r1) / 2, w); ctx.closePath(); }
function darts(f, n, r0, r1, w, fill, line) { for (let i = 0; i < n; i++) { ctx.save(); ctx.rotate((i + fxRnd(f.seed, i)) / n * Math.PI * 2); dartPath(r0, r0 + (r1 - r0) * (0.5 + 0.5 * fxRnd(f.seed, i + 50)), w); inked(fill, line); ctx.restore(); } }
function ringPath(r) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); }
function inkRing(r, w, col) { ringPath(r); ctx.strokeStyle = INK; ctx.lineWidth = w + 3; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); }

// --- projectiles. Shape backs up colour: streak = yours, jagged ember = dodge, ringed orb = parry, bolt = sent back
function tracer(len, w, col, core) {
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(0, -w); ctx.lineTo(-len, 0); ctx.lineTo(0, w); ctx.closePath(); inked(col, 1.5);
  ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(0, -w / 2); ctx.lineTo(-len * 0.6, 0); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fillStyle = core; ctx.fill();
}
function drawShot(b) {
  const orb = b.refl || (b.ctr && !b.cdmg);
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
  if (b.cdmg) { tracer(26, 5, CYAN, CRIMSON); }
  else if (orb) {
    const col = b.ctr ? CYAN : GOLD, r = 6 + Math.sin(rt / 4) * 0.8;
    if (b.ctr || b.home > 0) { ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-22, 0); ctx.lineTo(0, 5); ctx.closePath(); inked(col, 1); ctx.globalAlpha = 1; }
    if (!b.ctr) inkRing(r + 3.5, 1.5, col);
    ringPath(r); inked(col, 2);
    ringPath(2.5); ctx.fillStyle = PAPER; ctx.fill();
  } else if (b.team === 'p') b.pel ? tracer(8, 2.5, CRIMSON, PAPER) : tracer(16, 3, CRIMSON, PAPER);
  else { ctx.rotate(rt * 0.3); starPath(5, 8, 4.2, 1 + (rt >> 2) % 2); inked(EMBER, 1.5); ringPath(2.6); ctx.fillStyle = HOT; ctx.fill(); }
  ctx.restore();
}
function drawBomb(k, pulse) { // a magma core that cools with every hit; the timer ring keeps its meaning
  const f = k.timer / k.max, need = k.need || 8, heat = Math.max(0, Math.min(1, k.hits / need));
  const col = ['#2b2326', '#7a2d12', EMBER, AMBER, HOT][Math.round(heat * 4)];
  ctx.save(); ctx.translate(k.x + 10, k.y + 10);
  if (f < 0.3 && pulse) inkRing(13, 3, DANGER); // about to burst
  starPath(9, 13, 10, k.max + k.src); inked(col, 2);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-3, 1); ctx.lineTo(-5, 8); ctx.moveTo(9, 2); ctx.lineTo(4, -2); ctx.lineTo(5, -9); ctx.stroke();
  for (const [c, w] of [[INK, 6], [EMBER, 3]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + Math.max(0, f) * Math.PI * 2); ctx.stroke(); }
  ctx.textAlign = 'center'; label(k.hits, 0, 4, FONT_B(12), PAPER, 3); ctx.textAlign = 'left';
  ctx.restore();
}

// --- hit FX, started from sim events. t runs 0..1 over the effect's life
const FX_DRAW = {
  muzzle(f, t) {
    const p = f.p, a = p.aim; // rides the gun
    ctx.setTransform(f.base); ctx.translate(p.x + p.w / 2 + Math.cos(a) * KB.BARREL, p.y + KB.SHOULDER + Math.sin(a) * KB.BARREL); ctx.rotate(a);
    const L = f.r * (1 - t * 0.5);
    ctx.beginPath(); ctx.moveTo(-2, 0);
    for (let i = -f.n; i <= f.n; i++) { const b = i / f.n * 1.1, r = L * (i % 2 ? 0.55 : 1) * (0.75 + 0.25 * fxRnd(f.seed, i + 9)); ctx.lineTo(Math.cos(b) * r, Math.sin(b) * r); ctx.lineTo(Math.cos(b + 0.5 / f.n) * L * 0.35, Math.sin(b + 0.5 / f.n) * L * 0.35); }
    ctx.closePath(); inked(CRIMSON, 2); ctx.beginPath(); ctx.ellipse(L * 0.25, 0, L * 0.3, L * 0.14, 0, 0, 7); ctx.fillStyle = PAPER; ctx.fill();
  },
  spark(f, t) { ctx.globalAlpha = 1 - t * t; starPath(6, f.r * (0.6 + t * 0.6), f.r * 0.22 * (1 - t), f.seed); inked(PAPER, 2); },
  clank(f, t) { ctx.rotate(f.a + Math.PI); ctx.globalAlpha = 1 - t; for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate((fxRnd(f.seed, i) - 0.5) * 1.8); dartPath(4 + t * 8, 12 + t * 16, 1.5); inked(STEEL, 1.2); ctx.restore(); } },
  splat(f, t) { // black ink thrown along the bullet's path, never red
    ctx.rotate(f.a); ctx.globalAlpha = 1 - t * t; ctx.fillStyle = INK;
    for (let i = 0; i < 9; i++) { const d = (6 + 30 * fxRnd(f.seed, i)) * (0.35 + 0.65 * Math.sqrt(t)), b = (fxRnd(f.seed, i + 20) - 0.5) * 1.5, r = (1.5 + 3.5 * fxRnd(f.seed, i + 40)) * (1 - t * 0.5); ctx.save(); ctx.rotate(b); ctx.beginPath(); ctx.ellipse(d, 0, r * 1.7, r, 0, 0, 7); ctx.fill(); ctx.restore(); }
  },
  parry(f, t) {
    const g = 1 - (1 - t) ** 3; ctx.globalAlpha = 1 - t ** 3; ctx.rotate(f.seed);
    darts(f, 8, 12 + g * 30, 50 + g * 45, 3 * (1 - t), INK, 0.5);
    ctx.globalAlpha = 1 - t; inkRing(8 + g * 40, 4 * (1 - t) + 0.5, GOLD); starPath(7, 42 * (1 - t * 0.6), 11 * (1 - t), f.seed); inked(GOLD, 2.5);
    if (t < 0.6) { starPath(7, 20 * (1 - t), 6 * (1 - t), f.seed); ctx.fillStyle = PAPER; ctx.fill(); }
  },
  perfect(f, t) { ctx.globalAlpha = 1 - t * t; const L = 46 * (0.5 + t); dartPath(-L, L, 4 * (1 - t) + 0.5); inked(GOLD, 2); ctx.rotate(Math.PI / 2); dartPath(-L * 0.5, L * 0.5, 4 * (1 - t) + 0.5); inked(GOLD, 2); },
  stagger(f, t) { const g = 1 - (1 - t) ** 3; ctx.globalAlpha = 1 - t * t; darts(f, 11, 10 + g * 50, 30 + g * 75, 6 * (1 - t) + 1, PAPER, 2); },
  execute(f, t) { // one diagonal crimson slash with paper shards thrown off it
    const g = 1 - (1 - t) ** 4; ctx.globalAlpha = 1 - t ** 3; darts(f, 9, 20 + g * 60, 45 + g * 90, 5 * (1 - t) + 1, PAPER, 2);
    ctx.rotate(-0.6); const L = 60 + g * 130, w = 14 * (1 - t) + 1; dartPath(-L, L, w); inked(CRIMSON, 3); dartPath(-L * 0.8, L * 0.8, w * 0.35); ctx.fillStyle = PAPER; ctx.fill();
  },
  firework(f, t) { const g = 1 - (1 - t) ** 3; ctx.globalAlpha = 1 - t * t; darts(f, 12, 8 + g * 55, 20 + g * 75, 4 * (1 - t) + 0.5, t < 0.4 ? HOT : EMBER, 2); if (t < 0.5) { starPath(8, 30 * (1 - t), 12 * (1 - t), f.seed); inked(AMBER, 2); } },
  ring(f, t) { const g = 1 - (1 - t) ** 3; ctx.globalAlpha = 1 - t; inkRing(6 + g * f.r, 5 * (1 - t) + 0.5, f.col); }
};
function drawFx() { // drawn in world space
  fxs = fxs.filter(f => rt - f.at < FX_LIFE[f.k]);
  for (const f of fxs) {
    const t = (rt - f.at) / FX_LIFE[f.k];
    ctx.save(); f.base = ctx.getTransform(); ctx.translate(f.x, f.y); FX_DRAW[f.k](f, t); ctx.restore();
  }
}
function drawImpactFrame() { // 2-tick black panel behind a parry or execute; off with the flashes setting
  if (cfg.flashes && fxs.some(f => (f.k === 'parry' || f.k === 'execute' && !cutin) && rt - f.at < 3)) { ctx.globalAlpha = 0.72; ctx.fillStyle = INK; ctx.fillRect(-60, -60, KB.W + 120, KB.H + 120); ctx.globalAlpha = 1; }
}
function drawParts() { // ink-edged shards that stretch along their path
  const n = Math.min(6, rt - partsAt); partsAt = rt;
  for (const q of parts) {
    for (let i = 0; i < n; i++) { q.x += q.vx; q.y += q.vy; q.vy += 0.2; q.life--; }
    if (q.life <= 0) continue;
    const L = 2 + Math.min(6, Math.hypot(q.vx, q.vy));
    ctx.save(); ctx.globalAlpha = Math.min(1, q.life / 15); ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(q.vy, q.vx)); dartPath(-L, L, 1.8); inked(q.col, 0.7); ctx.restore();
  }
  parts = parts.filter(q => q.life > 0);
}
function fxEvent(e) {
  if (e.t === 'shot') fxAdd('muzzle', e.x, e.y, { p: s.players[0], r: e.gun === 'shotgun' ? 40 : e.gun === 'smg' ? 22 : 28, n: e.gun === 'shotgun' ? 4 : 2 });
  if (e.t === 'impact') {
    if (e.armor) fxAdd('clank', e.x, e.y, { a: e.a });
    else { fxAdd('splat', e.x, e.y, { a: e.a }); fxAdd('spark', e.x, e.y, { r: e.big ? 24 : 13 }); }
  }
  if (e.t === 'bombhit') fxAdd('spark', e.x, e.y, { r: 14 });
  if (e.t === 'parry') fxAdd('parry', e.x, e.y);
  if (e.t === 'perfect') fxAdd('perfect', e.x, e.y - 12);
  if (e.t === 'stagger') fxAdd('stagger', e.x, e.y + 20);
  if (e.t === 'execute') fxAdd('execute', e.x, e.y);
  if (e.t === 'boom') fxAdd('firework', e.x, e.y);
  if (e.t === 'defuse') fxAdd('ring', e.x, e.y, { r: 34, col: CYAN });
  if (e.t === 'phase') fxAdd('ring', e.x, e.y, { r: 190, col: EMBER });
  if (e.t === 'hurt') fxAdd('spark', e.x, e.y, { r: 38 });
}

// --- execute cut-in (art/cutin, built by assets/src/build_cutin.py). The sim step that lands the execute waits for the shot,
// so health bars, deaths and phase breaks all happen on it. Ticks: slam in, eye glint, shot, tear away, end.
const CUT = { boss: { slam: 8, glint: 22, shot: 28, out: 35, end: 45 }, duel: { slam: 6, glint: 11, shot: 16, out: 21, end: 28 } };
const CUT_IMG = [0, 1, 2].map(i => { const im = new Image(); im.src = 'assets/out/cutin_' + i + '.webp'; return im; });
const CUT_EYES = [[0.456, 0.237], [0.541, 0.273]], CUT_BORE = [0.931, 0.218]; // measured on the art, as fractions of its size
const CUT_SIZE = 560;
let cutin = null;
// soft light, added to whatever is under it
function glow(x, y, r, col, alpha) { flareAt(x, y, r, r, col, alpha); }
function flare(len, w, col, alpha) { flareAt(0, 0, len, w, col, alpha); flareAt(0, 0, len * 0.5, w * 3, col, alpha * 0.35); }
function flareAt(x, y, rx, ry, col, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= Math.min(1, alpha); ctx.translate(x, y); ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, col); g.addColorStop(0.35, col + '66'); g.addColorStop(1, col + '00');
  ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
}
function sheen(x, alpha) { // slanted beam, 180 px wide
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= alpha; ctx.transform(1, 0, -0.3, 1, 160, 0);
  const g = ctx.createLinearGradient(x - 90, 0, x + 90, 0); g.addColorStop(0, '#ffd9c000'); g.addColorStop(0.5, '#ffd9c0'); g.addColorStop(1, '#ffd9c000');
  ctx.fillStyle = g; ctx.fillRect(x - 90, -20, 180, KB.H + 40); ctx.restore();
}
function startCutin(inp) { // true = this press will land an execute; a copy of the sim is stepped to be sure
  if (!inp.execute || s.players[0].prevExec || !s.enemies.some(e => e.state === 'stagger') || !CUT_IMG.every(i => i.complete && i.naturalWidth)) return false;
  const next = structuredClone(s); KB.step(next, [inp]);
  const hit = next.events.find(e => e.t === 'execute');
  if (!hit) return false;
  cutin = { at: rt, inp, flip: hit.x < s.players[0].x + s.players[0].w / 2, seed: Math.random() * 99, ...CUT[hit.kind === 'boss' ? 'boss' : 'duel'] };
  band = null; SFX.cutin();
  return true;
}
function cutinHold() { // true while the sim must wait for the shot
  const t = rt - cutin.at;
  if (t === cutin.glint) SFX.glint();
  return t < cutin.shot;
}
function drawCutin() { // screen space, behind the fighters
  if (!cutin) return;
  const c = cutin, t = rt - c.at;
  if (t >= c.end) { cutin = null; return; }
  const W = KB.W, H = KB.H, ease = x => 1 - (1 - Math.max(0, Math.min(1, x))) ** 3;
  const slam = ease((t - 1) / (c.slam - 1)), out = Math.max(0, (t - c.out) / (c.end - c.out)), gone = out * out;
  ctx.save(); ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.globalAlpha = (cfg.flashes && t < 3 ? 1 : 0.6 * slam) * (1 - gone); ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = cfg.flashes ? 1 : 1 - out;
  if (c.flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  const kick = t >= c.shot ? Math.max(0, 1 - (t - c.shot) / 8) * cfg.shake / 100 : 0;
  ctx.translate((Math.random() - 0.5) * 14 * kick, (Math.random() - 0.5) * 10 * kick);
  if (cfg.flashes) ctx.translate(-gone * 760, gone * 90); // tears away along the slash
  // slanted panel, lit from behind KITE
  const lum = cfg.flashes ? 1 : 0.35, px = (slam - 1) * 700;
  const edge = d => { ctx.beginPath(); ctx.moveTo(-160, -160); ctx.lineTo(668 + px + d, -160); ctx.lineTo(498 + px + d, H + 20); ctx.lineTo(-160, H + 20); ctx.closePath(); };
  edge(9); ctx.fillStyle = INK; ctx.fill(); edge(3); ctx.fillStyle = PAPER; ctx.fill(); edge(0); ctx.fillStyle = '#1c060d'; ctx.fill();
  ctx.save(); edge(0); ctx.clip(); ctx.translate(px, 0);
  glow(290, 190, 470, CRIMSON, 0.75 * lum); glow(270, 150, 230 + t * 2, '#ff8a6a', 0.45 * lum);
  ctx.restore();
  // KITE, pinned to the bottom-left so the art's cropped edges stay off-screen
  const back = slam >= 1 ? Math.max(0, 1 - (t - c.slam) / 5) * 10 : 0, grow = 1 + 0.05 * Math.min(1, t / c.out) + 0.03 * kick;
  ctx.translate(-34 + (slam - 1) * 620 + back, H + 12); ctx.scale(grow, grow);
  const im = CUT_IMG[t < c.glint ? 0 : t < c.shot ? 1 : 2], n = 40, sw = im.naturalWidth / n, dw = CUT_SIZE / n;
  for (let i = 0; i < n; i++) { // hair and coat sway: only the trailing 40% moves, the face stays still
    const sway = (Math.max(0, 0.4 - i / n) / 0.4) ** 2 * 5 * Math.sin(t / 2.5 + i * 0.35);
    ctx.drawImage(im, i * sw, 0, sw, im.naturalHeight, i * dw, -CUT_SIZE + sway, dw + 0.6, CUT_SIZE);
  }
  const at = ([u, v]) => ctx.translate(u * CUT_SIZE, (v - 1) * CUT_SIZE);
  if (t >= c.glint && t < c.shot + 3) { // light catches his eyes
    const g = Math.sin(Math.min(1, (t - c.glint + 1) / (c.shot + 3 - c.glint)) * Math.PI) * lum;
    CUT_EYES.forEach((e, i) => { ctx.save(); at(e); glow(0, 0, i ? 34 : 46, '#ff3b4f', 0.9 * g); ctx.rotate(0.14); flare(i ? 90 : 190, 2.5, PAPER, g); ctx.restore(); });
  }
  if (t >= c.shot) { // the shot: one burst of light that blooms and fades
    const g = Math.max(0, 1 - (t - c.shot) / (c.end - c.shot)) ** 2 * lum, open = 1 + (t - c.shot) * 0.06;
    ctx.save(); at(CUT_BORE); glow(0, 0, 520 * open, EMBER, 0.6 * g); glow(0, 0, 250 * open, AMBER, 0.9 * g); glow(0, 0, 110, '#ffffff', g);
    flare(620 * open, 7, HOT, g); ctx.rotate(-1.25); flare(330 * open, 4, HOT, 0.8 * g); ctx.restore();
  }
  ctx.restore();
  // a soft band of light sweeps over the panel as he lands
  const sw2 = (t - 2) / (c.glint - 2);
  if (sw2 > 0 && sw2 < 1) {
    ctx.save(); ctx.setTransform(RS, 0, 0, RS, 0, 0); if (c.flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    edge(0); ctx.clip(); sheen(-200 + sw2 * 1000, 0.5 * lum * Math.sin(sw2 * Math.PI)); ctx.restore();
  }
}

// --- boss cut-ins: a lit band across the screen. 0 arrival, 1 phase 2, 2 phase 3, 3 staggered
const BAND_IMG = [0, 1, 2, 3].map(i => { const im = new Image(); im.src = 'assets/out/cutin_boss_' + i + '.webp'; return im; });
const BAND_EYE = [[0.755, 0.39], [0.685, 0.345], [0.665, 0.335], [0.74, 0.305]]; // brightest eye, as fractions of the art
let band = null;
function startBand(i, len) { // freezes the game for the length of the band; waits for an execute cut-in to leave first
  if (!BAND_IMG[i].complete || !BAND_IMG[i].naturalWidth) return;
  const wait = cutin ? Math.max(0, cutin.end - 6 - (rt - cutin.at)) : 0;
  band = { i, len, at: rt + wait }; hitstop = Math.max(hitstop, wait + len - 8); SFX.cutin();
}
const bandOn = () => band && rt >= band.at;
function drawBand() { // screen space, behind the fighters
  if (!bandOn()) return;
  const t = rt - band.at, W = KB.W;
  if (t >= band.len) { band = null; return; }
  const open = 1 - (1 - Math.min(1, t / 7)) ** 3, out = Math.max(0, (t - band.len + 9) / 9), lum = cfg.flashes ? 1 : 0.35, h = 150 * open * (1 - out * out);
  ctx.save(); ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.globalAlpha = 0.6 * open * (1 - out); ctx.fillStyle = INK; ctx.fillRect(0, 0, W, KB.H); ctx.globalAlpha = 1;
  ctx.translate(W / 2, 246); ctx.rotate(-0.045);
  ctx.fillStyle = INK; ctx.fillRect(-600, -h - 5, 1200, h * 2 + 10); ctx.fillStyle = AMBER; ctx.fillRect(-600, -h - 2, 1200, h * 2 + 4); ctx.fillStyle = '#170a08'; ctx.fillRect(-600, -h, 1200, h * 2);
  ctx.beginPath(); ctx.rect(-600, -h, 1200, h * 2); ctx.clip();
  glow(190, 0, 430, EMBER, 0.6 * lum); glow(150, -10, 210, AMBER, 0.4 * lum);
  ctx.save(); ctx.translate(530 + (1 - open) * 300 - t * 0.4, 160); ctx.scale(-1, 1); // faces left; the cropped edges stay outside the band
  const bw = 600, bh = 328; ctx.drawImage(BAND_IMG[band.i], 0, -bh, bw, bh);
  const p = t / band.len; ctx.translate(BAND_EYE[band.i][0] * bw, (BAND_EYE[band.i][1] - 1) * bh);
  const g = Math.max(0, Math.sin(Math.min(1, Math.max(0, p - 0.15) / 0.6) * Math.PI)) * lum; glow(0, 0, 60, AMBER, 0.8 * g); flare(300, 3, HOT, g);
  ctx.restore();
  ctx.translate(-W / 2, -246); if (p < 0.7) sheen(W + 100 - p * 1700, 0.35 * lum * Math.sin(p / 0.7 * Math.PI));
  ctx.restore();
}
