'use strict';
// Projectiles and hit FX, drawn as inked vectors (docs/art/environment.md). Render-only: reads sim state, never changes it.
// Everything ages on rt (60 Hz ticks), so FX keep playing through hit-stop and run at the same speed on any monitor.
const INK = '#0b0a0f', STEEL = '#9aa1b2', HOT = '#fff1a8';
const FX_LIFE = { muzzle: 5, spark: 8, nova: 30, beam: 12, clank: 8, splat: 18, parry: 22, perfect: 18, stagger: 24, execute: 26, firework: 26, ring: 18, ash: 48, spawn: 34, puff: 18, dash: 18 };
const FX_UNDER = new Set(['beam', 'spawn', 'puff', 'dash']); // drawn behind the fighters
const DUST = '#7a6a5c', ASH = '#2b2326', mobLast = new Map(); // enemy id -> last drawn pose, for the ash death
let fxs = [], partsAt = 0;
const fxRnd = (seed, i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
function fxAdd(k, x, y, o) { fxs.push({ k, x, y, a: 0, r: 20, col: PAPER, at: rt, seed: Math.random() * 99, ...o }); }
function fxClear() { fxs = []; mobLast.clear(); cutin = null; band = null; partsAt = rt; }

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

// --- projectiles. Shape backs up colour: streak = yours, magenta spiked ember = dodge, ringed orb = parry, bolt = sent back
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
  else { // can't be parried: magenta, spiked, with a long tail and a dark halo so it reads over lava
    flareAt(0, 0, 26, 26, DANGER, 0.5 + 0.2 * Math.sin(rt / 3));
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-34, 0); ctx.lineTo(0, 6); ctx.closePath(); inked(DANGER, 2);
    ctx.rotate(rt * 0.3); starPath(6, 13, 6, 1 + (rt >> 2) % 2); inked(DANGER, 3); ringPath(3.6); ctx.fillStyle = PAPER; ctx.fill();
  }
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

// --- warnings
function drawAlert(x, y, col) { // telegraph "!": an inked spike and diamond, popping on the beat
  const k = 1 + 0.12 * Math.sin(rt / 3);
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  ctx.beginPath(); for (const [a, b] of [[-7, -38], [8, -40], [3, -13], [-2, -13]]) ctx.lineTo(a, b); ctx.closePath(); inked(col, 2.5);
  ctx.beginPath(); for (const [a, b] of [[0, -9], [6, -3], [0, 3], [-6, -3]]) ctx.lineTo(a, b); ctx.closePath(); inked(col, 2.5);
  ctx.restore();
}
const novaTele = e => e && e.state === 'tele' && e.atk === 'nova';
function drawNovaDark(boss) { // ink over the arena, under the fighters
  if (!novaTele(boss)) return;
  ctx.globalAlpha = 0.45 * Math.min(1, (KB.BOSS.tele.nova[2] - boss.t) / 12); ctx.fillStyle = INK; ctx.fillRect(-60, -60, KB.W + 120, KB.H + 120); ctx.globalAlpha = 1;
}
function drawNovaWarning(boss) { // screen space: starts wider than the screen, touches the player on the tick it hits
  if (!novaTele(boss)) return;
  const p = s.players[0], f = boss.t / KB.BOSS.tele.nova[2], now = boss.t <= 5; // the last ticks are the just-dodge window
  const [x, y] = toScreen(p.x + p.w / 2, p.y + p.h / 2), r = 34 + 900 * f;
  const [bx, by] = toScreen(boss.x + boss.w / 2, boss.y + boss.h / 2);
  ctx.save(); ctx.translate(x, y); inkRing(r, 7, DANGER);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2; if (Math.hypot(x + Math.cos(a) * r - bx, y + Math.sin(a) * r - by) < 100) continue; // keep spikes off the boss
    ctx.save(); ctx.rotate(i / 24 * Math.PI * 2); ctx.beginPath(); ctx.moveTo(r + 26, -7); ctx.lineTo(r - 22, 0); ctx.lineTo(r + 26, 7); ctx.closePath(); inked(DANGER, 2); ctx.restore(); }
  inkRing(34, now ? 8 : 4, now && rt % 4 < 2 ? DANGER : PAPER); ctx.restore();
}
function drawNovaPulse(boss) { // under the boss: the blast comes from it. Gone before the ring's last third, so only one centre is left to read
  const f = boss.t / KB.BOSS.tele.nova[2];
  if (f < 0.34) return;
  ctx.save(); ctx.translate(boss.x + boss.w / 2, boss.y + boss.h / 2);
  for (const k of [0, 0.5]) { const u = ((1 - f) * 4 + k) % 1; ringPath(50 + u * 90); ctx.globalAlpha = 0.35 * (1 - u) * Math.min(1, (f - 0.34) * 8); ctx.strokeStyle = DANGER; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}
function drawSweepArc(e) { // brushed arc along the floor, the way it will go, with slashes toward the player
  ctx.save(); ctx.translate(e.x + e.w / 2, KB.FLOOR_Y - 2); ctx.scale(e.face, 1); ctx.beginPath(); ctx.moveTo(10, 0);
  for (let i = 1; i < 16; i++) ctx.lineTo(10 + i * 12, -(3 + 9 * fxRnd(e.id + (rt >> 3), i)) * Math.sin(Math.PI * i / 16));
  ctx.lineTo(202, 0); ctx.closePath(); inked(DANGER, 1.5);
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(40 + i * 42 + rt % 14, -3); dartPath(-12, 14, 1.8); ctx.fillStyle = INK; ctx.fill(); ctx.restore(); }
  ctx.restore();
}
function drawLaserAim(e) { // thin line while it tracks, hard line once it holds still
  if (e.beam > 0 || !(e.cd > 0 && e.cd <= KB.LASER.aim)) return;
  const lock = e.cd <= KB.LASER.lock, k = 1 - e.cd / KB.LASER.aim;
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + KB.GUNNER.pivot); ctx.rotate(e.aim); ctx.translate(KB.GUNNER.len, 0);
  ctx.globalAlpha = lock ? 1 : 0.6 + 0.4 * k;
  const snap = lock && e.cd > KB.LASER.lock - 3;
  if (!lock || e.cd <= 10) { ctx.setLineDash(lock ? [34, 10] : [14, 7]); ctx.lineDashOffset = -rt * (lock ? 9 : 2); } // the last ticks race, so lock never looks like the beam
  for (const [c, w] of [[INK, lock ? 8 : 5], [snap ? PAPER : DANGER, lock ? 4 : 2]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1500, 0); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1; flareAt(0, 0, 10 + 24 * k, 10 + 24 * k, DANGER, 0.9); inkRing(3 + 14 * (1 - k), 2.5, DANGER);
  ctx.restore();
  if (lock) drawAlert(e.x + e.w / 2, e.y - 16, DANGER);
}

// --- hit FX, started from sim events. t runs 0..1 over the effect's life
const FX_DRAW = {
  muzzle(f, t) {
    const p = f.p, a = p.aim; // rides the gun
    ctx.setTransform(f.base); const tip = HELD[p.guns[p.cur].id].tip; ctx.translate(p.x + p.w / 2 + Math.cos(a) * tip, p.y + KB.SHOULDER + Math.sin(a) * tip); ctx.rotate(a);
    const L = f.r * (1 - t * 0.5);
    ctx.beginPath(); ctx.moveTo(-2, 0);
    for (let i = -f.n; i <= f.n; i++) { const b = i / f.n * 1.1, r = L * (i % 2 ? 0.55 : 1) * (0.75 + 0.25 * fxRnd(f.seed, i + 9)); ctx.lineTo(Math.cos(b) * r, Math.sin(b) * r); ctx.lineTo(Math.cos(b + 0.5 / f.n) * L * 0.35, Math.sin(b + 0.5 / f.n) * L * 0.35); }
    ctx.closePath(); inked(CRIMSON, 2); ctx.beginPath(); ctx.ellipse(L * 0.25, 0, L * 0.3, L * 0.14, 0, 0, 7); ctx.fillStyle = PAPER; ctx.fill();
  },
  spark(f, t) { ctx.globalAlpha = 1 - t * t; starPath(6, f.r * (0.6 + t * 0.6), f.r * 0.22 * (1 - t), f.seed); inked(f.col, 2); },
  beam(f, t) { // full width while it hurts (first third), then collapses
    const w = 13 * (t < 0.34 ? 1 : (1 - t) ** 2); ctx.rotate(f.a);
    for (const [c, k, j] of [[INK, 0.95, 0.5], [DANGER, 0.55, 0.3], [PAPER, 0.2, 0.22]]) { // ragged edges that crackle along the beam
      ctx.beginPath(); ctx.moveTo(-4, 0);
      for (let i = 0; i <= 50; i++) ctx.lineTo(i * 30 + 6, -w * (k + j * fxRnd(f.seed + (rt >> 1), i)) * Math.min(1, 0.3 + i / 3));
      for (let i = 50; i >= 0; i--) ctx.lineTo(i * 30 + 6, w * (k + j * fxRnd(f.seed + (rt >> 1), i + 70)) * Math.min(1, 0.3 + i / 3));
      ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    }
    starPath(7, 22 * (1 - t), 8 * (1 - t), f.seed); inked(DANGER, 2);
  },
  nova(f, t) { ctx.globalAlpha = 1 - t; for (const k of [1, 0.75, 0.5]) inkRing(20 + t * 900 * k, 14 * (1 - t) + 1, DANGER); },
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
  ring(f, t) { const g = 1 - (1 - t) ** 3; ctx.globalAlpha = 1 - t; inkRing(6 + g * f.r, 5 * (1 - t) + 0.5, f.col); },
  ash(f, t) { // the body chars, then crumbles from the top down; flakes float up from the burning edge
    const M = MOBS[f.kind], im = MOB_IMG[f.kind], S = 1 / M.scale, w = M.w * S, h = M.h * S, top = -M.foot * S, L = f.pose, bh = f.kind === 'brute' || f.kind === 'reaver' ? 52 : h, by = top + h - bh, front = Math.max(0, (t - 0.1) / 0.6);
    const edge = i => by + bh * (front * 1.15 - 0.1) + (fxRnd(f.seed, i) - 0.5) * 9, n = 14;
    const line = () => { for (let i = 0; i <= n; i++) ctx.lineTo(-w / 2 + w * i / n, edge(i)); };
    if (front < 1 && im.complete && im.naturalWidth) {
      ctx.save(); ctx.scale(L.face, 1);
      ctx.beginPath(); line(); ctx.lineTo(w / 2, top + h); ctx.lineTo(-w / 2, top + h); ctx.closePath(); ctx.clip();
      const blit = src => ctx.drawImage(src, L.f * M.w, 0, M.w, M.h, -w / 2, top, w, h);
      blit(mobTint(f.kind, EMBER, 1)); // the glowing body shows only along the burning edge
      ctx.beginPath(); for (let i = 0; i <= n; i++) ctx.lineTo(-w / 2 + w * i / n, edge(i) + 3); ctx.lineTo(w / 2, top + h); ctx.lineTo(-w / 2, top + h); ctx.closePath(); ctx.clip();
      blit(t < 0.08 ? mobTint(f.kind, PAPER, 0.72) : mobTint(f.kind, ASH, 0.8));
      ctx.restore();
    }
    for (let i = 0; i < 34; i++) { // each flake leaves when the edge reaches its height
      const v = fxRnd(f.seed, i + 20), u = (t - 0.1 - v * 0.6) / 0.35;
      if (u <= 0 || u >= 1) continue;
      const x = (fxRnd(f.seed, i + 60) - 0.5) * Math.min(w, 60) * 0.8 + Math.sin(u * 5 + i) * 4 + u * 10 * (fxRnd(f.seed, i + 90) - 0.5), r = (1.4 + 2 * fxRnd(f.seed, i + 120)) * (1 - u * 0.6);
      ctx.save(); ctx.globalAlpha = 1 - u * u; ctx.translate(x, by + bh * v - u * 30); ctx.rotate(i + u * 4); dartPath(-r, r, r * 0.6); inked(i % 3 ? ASH : u < 0.5 ? AMBER : EMBER, 0.6); ctx.restore();
    }
    ctx.globalAlpha = Math.min(1, front) * (1 - Math.max(0, (t - 0.8) / 0.2)); // what is left on the floor
    ctx.beginPath(); ctx.moveTo(-18, 0); for (let i = 1; i < 8; i++) ctx.lineTo(-18 + i * 4.5, -(1 + 4 * fxRnd(f.seed, i + 150)) * Math.min(1, front)); ctx.lineTo(18, 0); ctx.closePath(); ctx.fillStyle = ASH; ctx.fill();
  },
  spawn(f, t) { // a molten tear in the air: snaps open, holds behind the newcomer, pinches shut
    const open = Math.min(1, t / 0.15) * (1 - Math.max(0, (t - 0.45) / 0.55) ** 2), H = 40 * (0.6 + 0.4 * open), w = 17 * open + 0.5;
    const tear = (k, j) => { ctx.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, r = (i % 2 ? 0.75 : 1.15) + j * (fxRnd(f.seed, i) - 0.5); ctx.lineTo(Math.sin(a) * Math.abs(Math.sin(a)) ** 0.4 * w * k * r, -Math.cos(a) * H * (0.6 + 0.4 * k)); } ctx.closePath(); };
    flareAt(0, 0, 60, 70, EMBER, 0.6 * open * (cfg.flashes ? 1 : 0.35)); ctx.rotate(0.12);
    if (t < 0.5) darts(f, 9, 22 + t * 40, 42 + t * 60, 2.5 * (1 - t * 2), INK, 0.5);
    tear(1, 0.6); inked(EMBER, 3); tear(0.7, 0.5); ctx.fillStyle = AMBER; ctx.fill(); tear(0.4, 0.4); ctx.fillStyle = HOT; ctx.fill();
    for (let i = 0; i < 7; i++) { const u = t * 1.3 - fxRnd(f.seed, i + 30) * 0.3; if (u <= 0 || u >= 1) continue; ctx.save(); ctx.translate((i - 3 + fxRnd(f.seed, i + 40)) * 5 * (1 + u), 10 + u * u * 34); ctx.rotate(Math.PI / 2); dartPath(-4, 4, 2 * (1 - u)); inked(AMBER, 0.8); ctx.restore(); } // drips
  },
  puff(f, t) { // dust kicked sideways along the ground; f.dir 0 = both ways
    const g = 1 - (1 - t) ** 3, dirs = f.dir ? [f.dir] : [-1, 1]; ctx.globalAlpha = 1 - t * t;
    for (const d of dirs) for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 5; i++) { // ink first, so the blobs merge into one outlined cloud
      const k = i / 4, r = (f.r * (0.18 + 0.16 * fxRnd(f.seed, i + (d > 0 ? 9 : 0)))) * (1 - t * 0.35) * (1.1 - k * 0.5) + (pass ? 0 : 1.6);
      ctx.beginPath(); ctx.arc(d * (4 + g * f.r * (0.35 + k)), -r * 0.7 - g * 5 * fxRnd(f.seed, i + 30), Math.max(0, r), 0, 7); ctx.fillStyle = pass ? DUST : INK; ctx.fill();
    }
    if (t < 0.5) for (const d of dirs) { ctx.save(); ctx.scale(d, 1); ctx.rotate(-0.22); dartPath(8 + g * f.r, 14 + g * f.r * 1.7, 2 * (1 - t * 2)); ctx.fillStyle = INK; ctx.fill(); ctx.restore(); }
  },
  dash(f, t) { // dry-brush streaks from where the dash began; the tails catch up
    const x = f.p.x + f.p.w / 2; if (f.p.dodge > 0 && Math.abs(x - f.hx) < 60) f.hx = x; // not across a respawn
    const D = f.hx - f.x, dir = f.dir; ctx.globalAlpha = 1 - t ** 3;
    for (let i = 0; i < 6; i++) {
      const y = -22 + i * 6 + fxRnd(f.seed, i) * 4, tail = D * Math.min(1, t * t * 1.2 + 0.25 * fxRnd(f.seed, i + 9)) - dir * 6, head = D - dir * (8 + 12 * fxRnd(f.seed, i + 20));
      if ((head - tail) * dir < 6) continue;
      const w = (i % 2 ? 1.2 : 2.4) * (1 - t * 0.6);
      ctx.beginPath(); ctx.moveTo(tail, y); ctx.lineTo(head - dir * 10, y - w); ctx.lineTo(head, y); ctx.lineTo(head - dir * 10, y + w); ctx.closePath(); inked(i % 3 === 1 ? CRIMSON : PAPER, 1.2);
    }
  }
};
function drawCrosshair() { // screen space, over the HUD; opens with each shot
  const g = 7 + 8 * Math.max(0, 1 - (rt - lastShot) / 10);
  ctx.save(); ctx.translate(mouse.x, mouse.y);
  ctx.rotate(0.14);
  for (let i = 0; i < 4; i++) { ctx.beginPath(); for (const [a, b] of [[g, 0], [g + 4, -2.4], [g + 11, -1.2], [g + 11, 1.2], [g + 4, 2.4]]) ctx.lineTo(a, b); ctx.closePath(); inked(PAPER, 1.5); ctx.rotate(Math.PI / 2); }
  dartPath(-3.4, 3.4, 3.4); inked(CRIMSON, 1.5);
  ctx.restore();
}
function drawExecuteCircle(e, near, pulse) { // brushed ring that empties clockwise as the stagger runs out; its outer edge is the exact execute range
  const R = KB.BOSS.executeRange, f = Math.max(0, e.t) / KB.BOSS.stagger, late = f < 0.25 && pulse, a0 = -Math.PI / 2, end = f * Math.PI * 2;
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a0 + end); ctx.closePath(); ctx.fillStyle = CRIMSON + (late ? '55' : near ? '33' : '1c'); ctx.fill();
  ctx.setLineDash([3, 9]); ringPath(R - 2); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = CRIMSON; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
  const n = Math.max(2, Math.ceil(f * 72)), thick = i => (3 + 4 * fxRnd(e.id, i)) * Math.min(1, (n - i) / 6) * (near ? 1.35 : 1); // brush thins out at the moving tip
  ctx.rotate(a0); ctx.beginPath();
  for (let i = 0; i <= n; i++) { const a = end * i / n; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
  for (let i = n; i >= 0; i--) { const a = end * i / n, r = R - thick(i); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); inked(late ? PAPER : CRIMSON, 2);
  ctx.save(); ctx.rotate(end); ctx.beginPath(); for (const [a, b] of [[R + 9, 0], [R - 2, -4], [R - 15, 0], [R - 2, 4]]) ctx.lineTo(a, b); ctx.closePath(); inked(PAPER, 2); ctx.restore(); // the moving hand
  if (near) { // in range: four blades close on the target
    const u = rt % 24 / 24, r = R - 16 - u * 22; ctx.globalAlpha = 1 - u * 0.7; ctx.rotate(Math.PI / 4);
    for (let i = 0; i < 4; i++) { dartPath(r - 14, r + 12, 5); inked(PAPER, 2.5); ctx.rotate(Math.PI / 2); }
  }
  ctx.restore();
}
function drawFx(under) { // drawn in world space, in two passes: under and over the fighters
  fxs = fxs.filter(f => rt - f.at < FX_LIFE[f.k]);
  for (const f of fxs) {
    if (FX_UNDER.has(f.k) !== !!under) continue;
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
  if (e.t === 'eshot') fxAdd('spark', e.x, e.y, { r: 22, col: GOLD });
  if (e.t === 'laser') fxAdd('beam', e.x, e.y, { a: e.a });
  if (e.t === 'battack' && e.atk === 'nova') fxAdd('nova', e.x, e.y);
  if (e.t === 'bombhit') fxAdd('spark', e.x, e.y, { r: 14 });
  if (e.t === 'parry') fxAdd('parry', e.x, e.y);
  if (e.t === 'perfect') fxAdd('perfect', e.x, e.y - 12);
  if (e.t === 'stagger') fxAdd('stagger', e.x, e.y + 20);
  if (e.t === 'execute') fxAdd('execute', e.x, e.y);
  if (e.t === 'boom') fxAdd('firework', e.x, e.y);
  if (e.t === 'defuse') fxAdd('ring', e.x, e.y, { r: 34, col: CYAN });
  if (e.t === 'phase') fxAdd('ring', e.x, e.y, { r: 190, col: EMBER });
  if (e.t === 'spawn') fxAdd('spawn', e.x + 12, e.y + 16);
  if (e.t === 'die' && e.kind !== 'boss') { fxAdd('ash', e.x, e.y + KB.ENEMIES[e.kind].h / 2, { kind: e.kind, pose: mobLast.get(e.id) || { f: 0, face: 1 } }); mobLast.delete(e.id); }
  if (e.t === 'dodge') {
    const p = s.players[0]; fxAdd('dash', e.x, e.y, { p, dir: p.dodgeDir, hx: e.x });
    if (p.ground) fxAdd('puff', e.x, p.y + p.h, { r: 24, dir: -p.dodgeDir });
  }
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
