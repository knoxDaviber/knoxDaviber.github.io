'use strict';
// The opening: the title is KITE already falling, Play lets him drop into the live arena. Render-only, one world, no cut:
// the shaft sits above the arena in world space and its pattern repeats, so the looping title can turn into the real fall at any moment.
const FALL_IMG = new Image(); FALL_IMG.src = 'assets/out/kite_fall.webp';
const DROP = { v0: 9, v: 20, ramp: 40, swap: 56, end: 150, short: 26, x: 594, period: 1400, rim: -22 }; // x: the gap between the ledges
let dropT = -1, shaftOff = 0, titleLast = 0, fallT = 0; // fallT: sway clock, kept apart from rt, which must stay whole
const dropDist = t => t < DROP.ramp ? DROP.v0 * t + (DROP.v - DROP.v0) / (2 * DROP.ramp) * t * t : (DROP.v0 + DROP.v) / 2 * DROP.ramp + DROP.v * (t - DROP.ramp);
const dropY = t => KB.FLOOR_Y - 17 - dropDist(DROP.end) + dropDist(t); // KITE's centre
const ramp01 = (t, a, b) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

function startDrop(full) { // full = from the title; otherwise only the landing
  dropT = full ? 0 : DROP.end - DROP.short; mode = 'drop';
  Object.assign(s.players[0], { x: DROP.x - s.players[0].w / 2, vy: 12, ground: false });
  if (full) SFX.fall();
}
function skipDrop() { if (dropT > 10) dropT = Math.max(dropT, DROP.end - DROP.short); } // the first ticks still belong to the click on Play
function stepDrop() { // one 60 Hz tick
  fallT++;
  if (++dropT < DROP.end) return;
  const p = s.players[0]; Object.assign(p, { y: KB.FLOOR_Y - p.h, vy: 0, ground: true });
  dropT = -1; mode = 'play'; wasGround = true; wasVy = 0; shake = 24; hitstop = 5;
  play('land'); SFX.land(); SFX.impact();
  for (const dir of [-1, 1]) fxAdd('puff', DROP.x, KB.FLOOR_Y, { r: 46, dir });
  fxAdd('ring', DROP.x, KB.FLOOR_Y - 4, { r: 110, col: PAPER });
  burst(DROP.x, KB.FLOOR_Y - 4, 24, DUST, 6);
  hideMenu();
  if (cfg.autoPause && !document.hasFocus()) pauseGame();
}
function dropCam() {
  const t = Math.max(0, dropT), k = ramp01(t, 4, 60);
  cam.z = 1 + (ZOOM - 1) * k;
  const hh = KB.H / 2 / cam.z;
  cam.x = DROP.x - 210 * (1 - k) / cam.z; cam.y = Math.min(dropY(t), KB.H - hh);
}
// calls fn(i, y) for n items spread over one period, at their world y; f = scroll speed, as in parallax()
function shaftItems(n, f, seed, fn) {
  const P = DROP.period, scroll = f * (cam.y + shaftOff);
  for (let i = 0; i < n; i++) { const d = (((i + fxRnd(seed, i)) / n * P - scroll) % P + P) % P - P / 2; fn(i, cam.y + d); }
}
function shaftEdge(side) { // jagged rock face, INK outward to far off-screen
  const step = 35, rows = DROP.period / step, n0 = Math.floor((cam.y + shaftOff - 420) / step);
  ctx.beginPath(); ctx.moveTo(DROP.x + side * 1200, n0 * step - shaftOff);
  for (let n = n0; n < n0 + 25; n++) { const m = ((n % rows) + rows) % rows; ctx.lineTo(DROP.x + side * (205 + 70 * fxRnd(side > 0 ? 5 : 6, m)), n * step - shaftOff); }
  ctx.lineTo(DROP.x + side * 1200, (n0 + 24) * step - shaftOff); ctx.closePath();
}
function drawShaft() { // world space, over the backdrop; nothing below the rim
  const hh = KB.H / 2 / cam.z + 30, hw = KB.W / 2 / cam.z + 30, top = cam.y - hh, R = DROP.rim;
  if (top > R) return;
  const lip = new Path2D(); lip.moveTo(cam.x - hw, top); lip.lineTo(cam.x + hw, top);
  for (let i = 60; i >= 0; i--) lip.lineTo(i * 34 - 540, R - 34 * fxRnd(7, i)); // ragged lip
  lip.closePath(); ctx.save(); ctx.save(); ctx.clip(lip);
  const g = ctx.createLinearGradient(0, cam.y - hh, 0, cam.y + hh); g.addColorStop(0, '#0d0b12'); g.addColorStop(0.55, '#2a0f16'); g.addColorStop(1, '#8a2f12');
  ctx.fillStyle = g; ctx.fillRect(cam.x - hw, top, hw * 2, hh * 2);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(DROP.x, cam.y + hh, 330, EMBER, 0.45); ctx.restore();
  for (const [f, n, seed, col] of [[0.3, 9, 21, '#1d0c13'], [0.55, 8, 22, '#140910']]) { // far rock spurs from both sides
    ctx.fillStyle = col;
    shaftItems(n, f, seed, (i, y) => { const sd = i % 2 ? 1 : -1, len = 70 + 130 * fxRnd(seed + 9, i), h = 60 + 80 * fxRnd(seed + 5, i); ctx.beginPath(); ctx.moveTo(DROP.x + sd * 520, y - h); ctx.lineTo(DROP.x + sd * (330 - len), y); ctx.lineTo(DROP.x + sd * 520, y + h * 0.6); ctx.closePath(); ctx.fill(); });
  }
  for (const sd of [-1, 1]) { shaftEdge(sd); ctx.fillStyle = INK; ctx.fill(); ctx.strokeStyle = '#7a2a12'; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.fillStyle = AMBER; // embers hang in the air, so he falls past them
  shaftItems(34, 0.8, 31, (i, y) => { const r = 1 + 1.6 * fxRnd(33, i); ctx.globalAlpha = 0.75; ctx.save(); ctx.translate(DROP.x + (fxRnd(32, i) - 0.5) * 420, y); ctx.scale(1, 4); ctx.rotate(0.785); ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore(); });
  ctx.restore();
  ctx.globalAlpha = 1; ctx.strokeStyle = INK; ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.stroke(lip); ctx.restore();
}
function drawSpeedLines(a) {
  ctx.save(); ctx.fillStyle = PAPER;
  shaftItems(22, 1.5, 41, (i, y) => { const x = DROP.x + (fxRnd(42, i) - 0.5) * 520, l = 50 + 110 * fxRnd(43, i); ctx.globalAlpha = a * (0.25 + 0.5 * fxRnd(44, i)); ctx.beginPath(); ctx.moveTo(x, y - l); ctx.lineTo(x + 1.3, y); ctx.lineTo(x, y + l * 0.3); ctx.lineTo(x - 1.3, y); ctx.closePath(); ctx.fill(); });
  ctx.restore();
}
function drawChunkyFall() { // the game sprite, huge and tumbling; it shrinks into its own in-game size and place, so nothing is swapped
  if (!ready('air')) return;
  const t = Math.max(0, dropT), k = ramp01(t, 0, DROP.swap), bob = 1 - k, size = CELL * SPR, d = size + (700 - size) * bob;
  // feet drift to where drawPlayer puts them; the frame's middle row is 246
  ctx.save(); ctx.translate(DROP.x + Math.sin(fallT / 47) * 9 * bob, dropY(t) + 17 * k + Math.sin(fallT / 31) * 8 * bob);
  ctx.rotate((2.3 + Math.sin(fallT / 53) * 0.12) * bob);
  const f = dropT >= 0 ? 6 : fallT % 46 < 23 ? 6 : 5;
  ctx.drawImage(IMG.air, f * CELL, 0, CELL, CELL, -d / 2, -d * (246 + (FOOT_ROW - 246) * k) / CELL, d, d); ctx.restore();
}
function drawFallingKite() { // the drawing; coat and boots sway, the face stays still
  if (cfg.opening === 'chunky') { drawChunkyFall(); return; }
  if (!FALL_IMG.complete || !FALL_IMG.naturalWidth) return;
  const t = Math.max(0, dropT), k = ramp01(t, 0, DROP.swap), d = (430 - 352 * k) / (dropT < 0 ? 1 : 1 + (cam.z - 1) * 0.4), n = 40, sw = FALL_IMG.naturalWidth / n, bob = 1 - k;
  ctx.save(); ctx.translate(DROP.x + Math.sin(fallT / 47) * 9 * bob, dropY(t) + Math.sin(fallT / 31) * 8 * bob); ctx.rotate(Math.sin(fallT / 53) * 0.05 * bob + 0.5 * k);
  for (let i = 0; i < n; i++) { const sway = (Math.max(0, 0.6 - i / n) / 0.6) ** 2 * 12 * Math.sin(fallT / 5 + i * 0.3); ctx.drawImage(FALL_IMG, i * sw, 0, sw, FALL_IMG.naturalHeight, -d / 2 + i * d / n, -d / 2 + sway * d / 430, d / n + 0.6, d); }
  ctx.restore();
}
function drawAshCloud() { // he punches through it, and it hides the change from drawing to sprite
  const y0 = dropY(DROP.swap);
  if (Math.abs(y0 - cam.y) > 560) return;
  for (const [col, grow, dy] of [[INK, 7, 0], ['#3a2f2f', 0, 0], ['#4d403e', -20, -16]]) {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 42; i++) { const u = i % 14, v = i / 14 | 0; if (grow < -10 && v) break; const r = 34 + 20 * fxRnd(51, i) + grow, x = DROP.x - 420 + u * 64 + 30 * fxRnd(52, i), y = y0 + dy - 42 + v * 42 + 26 * fxRnd(53, i); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7); }
    ctx.fill();
  }
}
function drawDropUnder() { if (mode === 'drop') { drawShaft(); drawSpeedLines(0.6); } }
function drawDropOver() { if (mode === 'drop' && dropT < DROP.swap + 40 && cfg.opening !== 'chunky') drawAshCloud(); }
function drawMenu() { // title scene: the fall, looping
  const now = performance.now(), dt = Math.min(100, now - titleLast) / (1000 / 60); titleLast = now;
  shaftOff += DROP.v0 * dt; fallT += dt; dropCam();
  ctx.setTransform(RS, 0, 0, RS, 0, 0); ctx.fillStyle = INK; ctx.fillRect(0, 0, KB.W, KB.H);
  ctx.save(); ctx.translate(KB.W / 2, KB.H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  drawShaft(); drawSpeedLines(0.5); drawFallingKite(); ctx.restore();
}
