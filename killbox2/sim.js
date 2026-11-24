/* KILLBOX 2 simulation. Deterministic: step(state, inputs) with a seeded RNG in state.
   No DOM, no Math.random, no wall clock — so it can later run lockstep/host-authoritative online.
   State is plain JSON (snapshot = JSON.stringify).
   No HP: any hit costs a life and restarts the current wave / boss phase from its checkpoint. */
(function (root) {
  'use strict';

  const W = 960, H = 540, G = 0.6, MAX_FALL = 14, FLOOR_Y = 500;
  const PLATFORMS = [
    { x: 0, y: FLOOR_Y, w: 960, h: 40, solid: true },
    { x: 120, y: 380, w: 220, h: 14 }, { x: 620, y: 380, w: 220, h: 14 },
    { x: 370, y: 270, w: 220, h: 14 },
    { x: 0, y: 170, w: 170, h: 14 }, { x: 790, y: 170, w: 170, h: 14 }
  ];
  const SPAWNS = [{ x: 40, y: 120 }, { x: 900, y: 120 }, { x: 20, y: 440 }, { x: 920, y: 440 }];

  // ammo -1 = infinite (JSON-safe, unlike Infinity)
  const WEAPONS = {
    pistol:  { rate: 14, speed: 14, dmg: 10, spread: 0.03, pellets: 1, ammo: -1 },
    smg:     { rate: 5,  speed: 15, dmg: 7,  spread: 0.09, pellets: 1, ammo: 120 },
    shotgun: { rate: 38, speed: 13, dmg: 9,  spread: 0.28, pellets: 6, ammo: 24 }
  };
  const ENEMIES = {
    grunt:  { w: 24, h: 32, hp: 30, speed: 1.6 },
    gunner: { w: 24, h: 34, hp: 25, speed: 1.2 },
    orber:  { w: 24, h: 34, hp: 25, speed: 1.1 },   // fires white orbs: deflect them back (one-shots it)
    bomber: { w: 28, h: 30, hp: 25, speed: 1.0 },   // lobs a bomb: shoot it down
    brute:  { w: 34, h: 44, hp: 1, speed: 1.0 },    // armored duelist: only parry → stagger → execute kills it
    reaver: { w: 34, h: 44, hp: 1, speed: 1.0 },    // brute + combos + red sweep (jump/dodge)
    boss:   { w: 80, h: 90, hp: 500, speed: 1.0 }
  };
  // Wave 1 is the tutorial: `seq` spawns one at a time in order, each teaching one boss rule.
  const WAVES = [
    { seq: ['grunt', 'grunt', 'brute', 'orber', 'bomber', 'reaver'] },
    { grunt: 3, gunner: 1, orber: 1, brute: 1 },
    { grunt: 3, gunner: 2, orber: 1, bomber: 1, reaver: 1 }
  ];
  const BREAK = 300, SPAWN_GAP = 40, RESPAWN_INV = 90, LIVES = 3, MAX_LIVES = 5;
  // Just-frame dodge: a dash that is invulnerable ONLY for its first JUST ticks. Dodging a hit in that window
  // = perfect: the next shot is a riposte (counter damage + posture, split across pellets).
  const DODGE = { dash: 14, just: 6, speed: 11, cd: 40, riposte: 60, dmg: 30, posture: 20 };

  // Furi/Sekiro-style boss. Arrays are indexed by phase (0..2). Only telegraphed attacks hurt; its body doesn't.
  const BOSS = {
    // Parry/deflect = posture only, no damage. Stagger = 3x gun damage + EXECUTE (flat, close range, ends stagger).
    gunMul: 0.2, staggerMul: 3, postureMax: 100, posturePerParry: 34, posturePerDeflect: 12, stagger: 150,
    execute: 150, executeRange: 90, pity: 2,
    reach: { lunge: 165, sweep: 130 }, // spear tip, measured from the body centre in the thrust and sweep art
    postureDrain: 0.05, postureGrace: 240, // drain per tick, after `grace` ticks without a posture gain
    // unshot bomb erupts into homing white orbs (parry to deflect): count, speed, homing ticks per phase
    firework: [{ n: 8, speed: 4, home: 150 }, { n: 12, speed: 4.5, home: 170 }, { n: 16, speed: 5, home: 190 }],
    // lunge/combo: white, parry it. sweep: red, unparryable, jump it. floor/shock/storm: red zone, move.
    // burst: white orbs, parry to deflect back. spray: dodge. bomb: shoot it down.
    pools: [
      ['lunge', 'burst', 'floor', 'bomb', 'lunge', 'burst'],
      ['lunge', 'combo', 'spray', 'floor', 'shock', 'bomb', 'sweep', 'burst'],
      ['combo', 'combo', 'sweep', 'storm', 'shock', 'bomb', 'burst', 'spray', 'sweep']
    ],
    tele: { lunge: [45, 36, 28], sweep: [50, 40, 32], floor: [70, 55, 45], shock: [70, 55, 45], storm: [60, 55, 45],
      burst: [25, 20, 16], spray: [30, 24, 18], bomb: [30, 26, 22] },
    rest: [60, 45, 30],
    bombs: [{ n: 1, hits: 8, time: 360 }, { n: 2, hits: 8, time: 330 }, { n: 3, hits: 9, time: 300 }]
  };

  // Duelists use the boss's posture/attack machine with their own settings (single phase).
  const DUELISTS = {
    brute:  { ...BOSS, pools: [['lunge']], tele: { lunge: [60] }, rest: [80], posturePerParry: 50 },
    reaver: { ...BOSS, pools: [['lunge', 'combo', 'sweep']], tele: { lunge: [42], sweep: [48] }, rest: [60] }
  };
  const CFG = e => e.type === 'boss' ? BOSS : DUELISTS[e.type];

  function rand(s) {
    s.seed = (s.seed + 0x6D2B79F5) | 0;
    let t = s.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function newPlayer(x) {
    return { x, y: 400, w: 22, h: 34, vx: 0, vy: 0, ground: false, jumps: 2, prevJump: false,
      prevSwap: false, drop: 0, inv: 0, face: 1, aim: 0, cd: 0,
      parry: 0, parryCd: 0, prevParry: false,
      dodge: 0, dodgeCd: 0, prevDodge: false, prevExec: false, dodgeDir: 1, justed: false, riposte: 0,
      guns: [{ id: 'pistol', ammo: -1 }], cur: 0 };
  }

  function init(seed, nPlayers) {
    const players = [];
    for (let i = 0; i < (nPlayers || 1); i++) players.push(newPlayer(460 + i * 40));
    return { seed: seed | 0, tick: 0, phase: 'break', timer: 120, wave: 0, queue: [],
      players, enemies: [], bullets: [], pickups: [], bombs: [], lives: LIVES, cp: null, events: [], nextId: 1 };
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const center = e => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

  function moveBody(b, dropping) {
    const prevBottom = b.y + b.h;
    b.x = Math.max(0, Math.min(W - b.w, b.x + b.vx));
    b.vy = Math.min(MAX_FALL, b.vy + G);
    b.y += b.vy;
    b.ground = false;
    if (b.vy >= 0) for (const p of PLATFORMS) {
      if (dropping && !p.solid) continue;
      if (b.x + b.w > p.x && b.x < p.x + p.w && prevBottom <= p.y + 0.01 && b.y + b.h >= p.y) {
        b.y = p.y - b.h; b.vy = 0; b.ground = true; break;
      }
    }
    if (b.y < -200) b.y = -200;
  }

  // Players shoot from the sprite's gun muzzle (shoulder + barrel); enemies from their chest.
  const GUNNER = { pivot: 3, len: 40 }; // Spitter's cannon socket (below its top) and barrel length
  const SHOULDER = 12, BARREL = 30; // art: KITE's front fist height; pistol muzzle tip
  function fire(s, from, angle, wp, team) {
    const muzzle = team === 'p' && !from.id;
    const ox = from.x + from.w / 2 + (muzzle ? Math.cos(angle) * BARREL : 0);
    const oy = muzzle ? from.y + SHOULDER + Math.sin(angle) * BARREL : from.y + from.h * 0.4;
    for (let i = 0; i < wp.pellets; i++) {
      const a = angle + (rand(s) - 0.5) * 2 * wp.spread;
      const sp = wp.speed * (wp.pellets > 1 ? 0.85 + rand(s) * 0.3 : 1);
      s.bullets.push({ x: ox, y: oy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: wp.dmg, team, life: 90, src: from.id || 0, pel: wp.pellets > 1 });
    }
  }

  // --- lives + checkpoints
  function checkpoint(s) { s.cp = s.players.map(p => ({ guns: p.guns.map(g => ({ ...g })), cur: p.cur })); }

  // Any hit on a player. shortcut: in co-op one player's hit restarts everyone; revisit when co-op lands.
  function hit(s, q, cause) {
    if (q.inv > 0 || s.restart) return;
    if (q.dodge > DODGE.dash - DODGE.just) { // inside the just window
      if (!q.justed) {
        q.justed = true; q.riposte = DODGE.riposte; q.dodgeCd = 0;
        s.events.push({ t: 'perfect', x: q.x + q.w / 2, y: q.y + q.h / 2, cause });
      }
      return;
    }
    s.restart = cause;
    s.events.push({ t: 'hurt', x: q.x + q.w / 2, y: q.y + q.h / 2, cause });
  }

  function restart(s) {
    const cause = s.restart; s.restart = null;
    s.lives--;
    if (s.lives < 0) { s.lives = 0; s.phase = 'dead'; s.events.push({ t: 'lose' }); return; }
    s.bullets = []; s.bombs = []; s.pickups = [];
    s.players.forEach((p, i) => {
      Object.assign(p, { x: 100 + i * 40, y: FLOOR_Y - p.h, vx: 0, vy: 0, inv: RESPAWN_INV, parry: 0, parryCd: 0, cd: 0, dodge: 0, dodgeCd: 0, riposte: 0 });
      if (s.cp) { p.guns = s.cp[i].guns.map(g => ({ ...g })); p.cur = s.cp[i].cur; }
    });
    const boss = s.enemies.find(e => e.type === 'boss');
    if (boss) {
      Object.assign(boss, { hp: boss.max, posture: 0, state: 'trans', t: 90, x: 700, vx: 0 });
    } else if (s.phase === 'wave') {
      s.enemies = []; s.wave--; s.phase = 'break'; s.timer = 90; // director rebuilds the same wave
    }
    s.events.push({ t: 'lifelost', left: s.lives, cause, boss: !!boss });
  }

  function stepPlayer(s, p, inp, idx) {
    // Sekiro parry: short window; whiffing costs a cooldown, a successful parry refunds it (chain parries).
    if (p.parry > 0) p.parry--;
    if (p.parryCd > 0) p.parryCd--;
    if (inp.parry && !p.prevParry && p.parryCd === 0) {
      p.parry = 10; p.parryCd = 28;
      s.events.push({ t: 'parrytry', x: p.x + p.w / 2, y: p.y + p.h / 2 });
    }
    p.prevParry = !!inp.parry;

    p.aim = inp.aim || 0; // angle from the shoulder (x center, y + SHOULDER)
    p.face = Math.cos(p.aim) >= 0 ? 1 : -1;
    if (p.dodgeCd > 0) p.dodgeCd--;
    if (p.riposte > 0) p.riposte--;
    if (inp.dodge && !p.prevDodge && p.dodgeCd === 0 && p.dodge === 0) {
      p.dodge = DODGE.dash; p.dodgeCd = DODGE.cd; p.justed = false;
      p.dodgeDir = inp.left ? -1 : inp.right ? 1 : p.face;
      s.events.push({ t: 'dodge', x: p.x + p.w / 2, y: p.y + p.h / 2 });
    }
    p.prevDodge = !!inp.dodge;

    const accel = p.ground ? 1.2 : 0.7, max = 4.2;
    if (p.dodge > 0) { p.dodge--; p.vx = p.dodgeDir * DODGE.speed; p.vy = Math.min(p.vy, 0); if (p.dodge === 0) p.vx = p.dodgeDir * max; }
    else if (inp.left) p.vx = Math.max(-max, p.vx - accel);
    else if (inp.right) p.vx = Math.min(max, p.vx + accel);
    else p.vx *= p.ground ? 0.7 : 0.95;
    if (p.ground) p.jumps = 2;
    if (inp.jump && !p.prevJump && p.jumps > 0) {
      p.vy = p.jumps === 2 ? -11.5 : -9.5; p.jumps--; p.ground = false;
      s.events.push({ t: 'jump', x: p.x + p.w / 2, y: p.y + p.h });
    }
    p.prevJump = !!inp.jump;
    if (inp.down && p.ground) p.drop = 10;
    if (p.drop > 0) p.drop--;
    moveBody(p, p.drop > 0);

    if (inp.swap && !p.prevSwap && p.guns.length > 1) {
      p.cur = (p.cur + 1) % p.guns.length;
      s.events.push({ t: 'swap', p: idx });
    }
    p.prevSwap = !!inp.swap;

    if (p.cd > 0) p.cd--;
    const g = p.guns[p.cur], wp = WEAPONS[g.id];
    if (inp.shoot && p.cd === 0 && p.parry === 0 && p.dodge === 0) { // no firing during parry/dodge: those poses hide the gun arm
      if (g.ammo === 0) {
        p.cur = 0; // out of ammo: fall back to pistol
        s.events.push({ t: 'empty', p: idx });
      } else {
        const n0 = s.bullets.length;
        fire(s, p, p.aim, wp, 'p');
        if (p.riposte > 0) { // riposte shot: counter damage split across pellets
          for (let i = n0; i < s.bullets.length; i++) Object.assign(s.bullets[i], { ctr: true, cdmg: DODGE.dmg / wp.pellets, cpost: DODGE.posture / wp.pellets, dmg: s.bullets[i].dmg * 3 });
          p.riposte = 0;
          s.events.push({ t: 'riposte', x: p.x + p.w / 2, y: p.y + p.h * 0.4 });
        }
        if (g.ammo > 0) g.ammo--;
        p.cd = wp.rate;
        s.events.push({ t: 'shot', gun: g.id, x: p.x + p.w / 2, y: p.y + SHOULDER, a: p.aim });
      }
    }
    if (p.inv > 0) p.inv--;
  }

  function nearestPlayer(s, e) {
    let best = null, bd = 1e9;
    for (const p of s.players) {
      const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function spawnEnemy(s, type) {
    const sp = type === 'boss' ? { x: 700, y: -100 } : SPAWNS[Math.floor(rand(s) * SPAWNS.length)];
    const d = ENEMIES[type];
    s.enemies.push({ id: s.nextId++, type, x: sp.x, y: sp.y, w: d.w, h: d.h, vx: 0, vy: 0,
      ground: false, hp: d.hp, max: d.hp, cd: 60 + Math.floor(rand(s) * 60), drop: 0, atk: '',
      ph: 0, state: 'trans', t: 90, posture: 0, face: 1, combo: 0, last: '', hitDone: false });
    s.events.push({ t: type === 'boss' ? 'boss' : 'spawn', x: sp.x, y: sp.y });
  }

  function spawnBoss(s) {
    s.phase = 'boss'; s.wave = WAVES.length;
    spawnEnemy(s, 'boss');
    checkpoint(s);
    return s.enemies[s.enemies.length - 1];
  }

  // kind: 'gun' (20%, x3 staggered) | 'counter' (full, x3 staggered) | 'flat' (execute: exact amount)
  function damageBoss(s, e, dmg, kind) {
    if (e.state === 'trans') return;
    const mul = kind === 'flat' ? 1 : (kind === 'gun' ? BOSS.gunMul : 1) * (e.state === 'stagger' ? BOSS.staggerMul : 1);
    e.hp -= dmg * mul;
    s.events.push({ t: 'hit', x: e.x + e.w / 2, y: e.y + e.h / 2, kind: 'boss', big: kind !== 'gun' });
    if (e.hp <= 0 && e.ph < 2) { // phase break: new checkpoint + a life back
      e.ph++; e.hp = e.max; e.state = 'trans'; e.t = 120; e.posture = 0; e.vx = 0;
      s.bullets = s.bullets.filter(b => b.team === 'p'); s.bombs = [];
      s.lives = Math.min(MAX_LIVES, s.lives + 1);
      checkpoint(s);
      s.events.push({ t: 'phase', n: e.ph + 1, x: e.x + e.w / 2, y: e.y + e.h / 2 });
    }
  }

  const PARRYABLE = ['lunge', 'combo', 'burst']; // bombs also feed posture, but only if you miss them

  function addPosture(s, e, n) {
    if (e.state === 'stagger' || e.state === 'trans') return; // no gaining (or re-staggering) mid-stagger
    const C = CFG(e); if (!C) return;
    e.posture += n; e.postT = s.tick;
    if (e.posture >= C.postureMax && e.state !== 'trans') {
      e.state = 'stagger'; e.t = C.stagger; e.posture = C.postureMax; e.vx = 0;
      s.events.push({ t: 'stagger', x: e.x + e.w / 2, y: e.y });
    }
  }

  function bossTele(s, e, atk, ticks) {
    e.state = 'tele'; e.atk = atk; e.t = ticks;
    s.events.push({ t: 'tele', atk, x: e.x + e.w / 2, y: e.y });
  }

  function stepBoss(s, e, p, dx, dir, dy) {
    const ph = e.ph, C = CFG(e);
    e.t--;
    if (e.state !== 'stagger' && e.posture > 0 && s.tick - (e.postT || 0) > C.postureGrace) e.posture = Math.max(0, e.posture - C.postureDrain);
    if (e.state === 'trans' || e.state === 'stagger' || e.state === 'recover') {
      e.vx *= 0.85;
      if (e.t <= 0) { if (e.state === 'stagger') e.posture = 0; e.state = 'idle'; e.t = C.rest[ph]; }
    } else if (e.state === 'idle') {
      if (p) { e.face = dir; e.vx = Math.abs(dx) > 160 ? dir * 1.3 : e.vx * 0.8; }
      // follow the player between levels so lunges can reach: drop through or hop up
      if (e.ground && dy > 60) e.drop = 12;
      else if (e.ground && dy < -70 && rand(s) < 0.04) e.vy = -13.5;
      if (e.t <= 0) {
        // pity: after `pity` attacks in a row with nothing to parry, force a parryable one (keeps posture reachable)
        const pool = (e.dry || 0) >= C.pity ? C.pools[ph].filter(x => PARRYABLE.includes(x)) : C.pools[ph];
        let pick = pool[Math.floor(rand(s) * pool.length)];
        if (pick === e.last && pool.length > 1) pick = pool[Math.floor(rand(s) * pool.length)];
        e.dry = PARRYABLE.includes(pick) ? 0 : (e.dry || 0) + 1;
        e.last = pick;
        if (pick === 'combo') { e.combo = ph === 2 ? 3 : 2; pick = 'lunge'; } else e.combo = 1;
        bossTele(s, e, pick, C.tele[pick][ph]);
      }
    } else if (e.state === 'tele') {
      e.vx *= 0.7;
      if (p && e.t > 10) e.face = dir; // tracks you, then commits
      if (e.t <= 0) {
        const aim = p ? Math.atan2((p.y + p.h / 2) - (e.y + e.h / 2), dx) : 0;
        if (e.atk === 'lunge' || e.atk === 'sweep') { e.state = 'act'; e.t = e.atk === 'sweep' ? 60 : 26; e.hitDone = false; s.events.push({ t: 'lunge', x: e.x + e.w / 2, y: e.y + e.h / 2 }); }
        else if (e.atk === 'floor' || e.atk === 'shock' || e.atk === 'storm') {
          e.state = 'act'; e.t = 80; s.events.push({ t: 'hazard', atk: e.atk });
          if (e.atk === 'storm') for (let i = 0; i < 16; i++) fire(s, e, (i / 16) * Math.PI * 2, { pellets: 1, spread: 0, speed: 4, dmg: 0 }, 'e');
        }
        else {
          if (e.atk === 'burst') {
            const n0 = s.bullets.length;
            fire(s, e, aim, { pellets: ph === 0 ? 3 : 5, spread: 0.2, speed: 8, dmg: 0 }, 'e');
            for (let i = n0; i < s.bullets.length; i++) s.bullets[i].refl = true; // white orbs: parry to deflect
          }
          if (e.atk === 'spray') {
            const n = 14 + ph * 4;
            for (let i = 0; i < n; i++) fire(s, e, (i / n) * Math.PI * 2 + rand(s) * 0.3, { pellets: 1, spread: 0, speed: 5, dmg: 0 }, 'e');
          }
          if (e.atk === 'bomb') {
            const B = C.bombs[ph];
            for (let i = 0; i < B.n; i++) s.bombs.push({ src: e.id, x: e.x + e.w / 2 - 10, y: e.y, w: 20, h: 20,
              vx: (rand(s) - 0.5) * 12, vy: -9 - rand(s) * 4, ground: false, hits: B.hits, need: B.hits, timer: B.time, max: B.time });
          }
          s.events.push({ t: 'battack', atk: e.atk, x: e.x + e.w / 2, y: e.y + e.h / 2 });
          e.state = 'recover'; e.t = 30;
        }
      }
    } else if (e.state === 'act') {
      if (e.atk === 'lunge') {
        e.vx = e.face * 13;
        const box = reachBox(e, 'lunge', { x: e.x - 6, y: e.y, w: e.w + 12, h: e.h });
        for (const q of s.players) if (!e.hitDone && overlap(box, q)) {
          if (q.parry > 0) {
            e.hitDone = true; q.parry = 0; q.parryCd = 0; q.vx = e.face * 4;
            e.vx = -e.face * 6;
            s.events.push({ t: 'parry', x: (e.x + e.w / 2 + q.x + q.w / 2) / 2, y: q.y + q.h / 2 });
            addPosture(s, e, C.posturePerParry);
            if (e.state === 'stagger') return;
            e.t = 0; // parry ends this swing
          } else if (q.inv === 0) { e.hitDone = true; hit(s, q, 'lunge'); }
        }
        if (e.t <= 0 || (e.face < 0 && e.x <= 0) || (e.face > 0 && e.x >= W - e.w)) {
          e.vx = 0;
          if (--e.combo > 0) bossTele(s, e, 'lunge', 20 - ph * 2);
          else { e.state = 'recover'; e.t = 45; } // punish window
        }
      } else if (e.atk === 'sweep') { // perilous: low dash along the floor, parry does nothing — jump it
        e.vx = e.face * 15;
        for (const q of s.players) if (!e.hitDone && q.y + q.h >= FLOOR_Y - 26 && overlap(reachBox(e, 'sweep', { x: e.x, y: FLOOR_Y - 40, w: e.w, h: 40 }), q)) { e.hitDone = true; hit(s, q, 'sweep'); }
        if (e.t <= 0 || (e.face < 0 && e.x <= 0) || (e.face > 0 && e.x >= W - e.w)) { e.vx = 0; e.state = 'recover'; e.t = 40; }
      } else { // floor/storm: everything on the ground burns; shock: every platform is live
        e.vx *= 0.8;
        for (const q of s.players) {
          const onFloor = q.y + q.h >= FLOOR_Y - 1;
          if (q.ground && (e.atk === 'shock' ? !onFloor : onFloor)) hit(s, q, e.atk);
        }
        if (e.t <= 0) { e.state = 'recover'; e.t = 20; }
      }
    }
  }

  function reachBox(e, atk, box) { // only the boss has a spear: extend its hit area forward to the tip
    if (e.type !== 'boss') return box;
    const cx = e.x + e.w / 2, r = BOSS.reach[atk];
    const left = e.face < 0 ? Math.min(box.x, cx - r) : box.x, right = e.face > 0 ? Math.max(box.x + box.w, cx + r) : box.x + box.w;
    return { x: left, y: box.y, w: right - left, h: box.h };
  }

  function stepEnemy(s, e) {
    const d = ENEMIES[e.type], p = nearestPlayer(s, e);
    const dx = (p.x + p.w / 2) - (e.x + e.w / 2), dy = (p.y + p.h / 2) - (e.y + e.h / 2);
    const dir = Math.sign(dx) || 1;
    if (CFG(e)) { stepBoss(s, e, p, dx, dir, dy); if (e.drop > 0) e.drop--; moveBody(e, e.drop > 0); return; }
    if (e.cd > 0) e.cd--;
    if (e.type === 'grunt') {
      e.vx = dir * d.speed;
      if (e.ground && dy < -60 && rand(s) < 0.03) e.vy = -11;
      if (e.ground && dy > 60 && rand(s) < 0.02) e.drop = 12;
    } else { // ranged: gunner / orber / bomber keep their distance
      const want = Math.abs(dx) > 300 ? dir : Math.abs(dx) < 200 ? -dir : 0;
      e.vx = want * d.speed;
      if (e.ground && dy < -60 && rand(s) < 0.015) e.vy = -11;
      if (e.cd === 0 && e.type === 'bomber') {
        s.bombs.push({ src: e.id, x: e.x + 4, y: e.y - 10, w: 20, h: 20, vx: Math.max(-7, Math.min(7, dx / 40)), vy: -9,
          ground: false, hits: 5, need: 5, timer: 300, max: 300 });
        e.cd = 420; s.events.push({ t: 'battack', atk: 'bomb', x: e.x, y: e.y });
      } else if (e.cd === 0) {
        const n0 = s.bullets.length, gun = e.type === 'gunner', py = e.y + GUNNER.pivot;
        const aim = gun ? Math.atan2((p.y + p.h / 2) - py, dx) : Math.atan2(dy, dx);
        fire(s, e, aim, { pellets: 1, spread: 0.05, speed: e.type === 'orber' ? 5 : 6, dmg: 0 }, 'e');
        if (gun) Object.assign(s.bullets[n0], { x: e.x + e.w / 2 + Math.cos(aim) * GUNNER.len, y: py + Math.sin(aim) * GUNNER.len }); // leaves the cannon's muzzle
        if (e.type === 'orber') s.bullets[n0].refl = true;
        e.cd = e.type === 'orber' ? 100 : 90; s.events.push({ t: 'eshot', x: e.x, y: e.y, orb: e.type === 'orber' });
      }
    }
    if (e.drop > 0) e.drop--;
    moveBody(e, e.drop > 0);
    for (const q of s.players) if (overlap(e, q)) hit(s, q, e.type);
  }

  function dropLoot(s, e) {
    if (e.type === 'boss') return;
    const r = rand(s);
    let kind = null;
    if (r < 0.22) kind = rand(s) < 0.5 ? 'smg' : 'shotgun';
    else if (r < 0.5) kind = 'ammo';
    else if (r < 0.54) kind = 'life';
    if (kind) s.pickups.push({ kind, x: e.x, y: e.y, w: 18, h: 18, vx: 0, vy: -4, ground: false, life: 900 });
  }

  function collect(s, p, k) {
    if (k.kind === 'life') s.lives = Math.min(MAX_LIVES, s.lives + 1);
    else if (k.kind === 'ammo') { for (const g of p.guns) if (g.ammo >= 0) g.ammo += Math.ceil(WEAPONS[g.id].ammo / 2); }
    else {
      const have = p.guns.findIndex(g => g.id === k.kind);
      if (have >= 0) p.guns[have].ammo += WEAPONS[k.kind].ammo;
      else { p.guns.push({ id: k.kind, ammo: WEAPONS[k.kind].ammo }); p.cur = p.guns.length - 1; }
    }
    s.events.push({ t: 'pickup', kind: k.kind, x: k.x, y: k.y });
  }

  function stepDirector(s) {
    if (s.hold) return; // the tutorial holds the first wave until the player has tried the basic controls
    if (s.phase === 'break') {
      if (--s.timer > 0) return;
      if (s.wave < WAVES.length) {
        const w = WAVES[s.wave];
        s.queue = w.seq ? w.seq.slice() : [];
        s.seq = !!w.seq;
        if (!w.seq) for (const t in w) for (let i = 0; i < w[t]; i++) s.queue.push(t);
        if (!w.seq) for (let i = s.queue.length - 1; i > 0; i--) { // seeded shuffle
          const j = Math.floor(rand(s) * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
        }
        s.wave++; s.phase = 'wave'; s.timer = 0;
        checkpoint(s);
        s.events.push({ t: 'wave', n: s.wave });
      } else spawnBoss(s);
    } else if (s.phase === 'wave') {
      if (s.queue.length && (!s.seq || !s.enemies.length) && --s.timer <= 0) { spawnEnemy(s, s.queue.shift()); s.timer = s.seq ? 60 : SPAWN_GAP; }
      if (!s.queue.length && !s.enemies.length) { s.phase = 'break'; s.timer = BREAK; s.events.push({ t: 'cleared' }); }
    } else if (s.phase === 'boss') {
      if (!s.enemies.length) { s.phase = 'clear'; s.events.push({ t: 'win' }); }
    }
  }

  // inputs[i] = { left, right, jump, down, shoot, swap, parry, aim } for player i
  function step(s, inputs) {
    s.events = [];
    if (s.phase === 'clear' || s.phase === 'dead') return s;
    s.tick++;
    s.players.forEach((p, i) => stepPlayer(s, p, inputs[i] || {}, i));
    stepDirector(s);
    for (const e of s.enemies) stepEnemy(s, e);

    for (const b of s.bullets) {
      if (b.home > 0 && b.team === 'e') { // homing orb: fly out, then steer toward the nearest player (limited turn rate)
        if (b.delay > 0) { b.delay--; b.vx *= 0.93; b.vy *= 0.93; }
        else {
          b.home--;
          const q = nearestPlayer(s, b);
          const want = Math.atan2(q.y + q.h / 2 - b.y, q.x + q.w / 2 - b.x);
          let cur = Math.atan2(b.vy, b.vx), d = want - cur;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          cur += Math.max(-0.07, Math.min(0.07, d));
          b.vx = Math.cos(cur) * b.sp; b.vy = Math.sin(cur) * b.sp;
        }
      }
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.x < -20 || b.x > W + 20 || b.y < -40 || (b.y > FLOOR_Y && !(b.home > 0))) b.life = 0;
      if (b.home > 0 && b.y > FLOOR_Y - 3) { b.y = FLOOR_Y - 3; b.vy = -Math.abs(b.vy); } // orbs skim the floor instead of dying
      const pt = { x: b.x - 2, y: b.y - 2, w: 4, h: 4 };
      if (b.team === 'p') {
        for (const k of s.bombs) if (b.life > 0 && k.hits > 0 && overlap(pt, k)) {
          k.hits--; b.life = 0; s.events.push({ t: 'bombhit', x: k.x + 10, y: k.y + 10, left: k.hits });
        }
        for (const e of s.enemies) if (b.life > 0 && e.hp > 0 && overlap(pt, e)) {
          s.events.push({ t: 'impact', x: b.x, y: b.y, a: Math.atan2(b.vy, b.vx), big: !!b.ctr, armor: !b.ctr && (e.type === 'boss' ? e.state === 'trans' : !!CFG(e)) });
          if (CFG(e) && b.ctr) { // riposte shot (boss: damage) / deflected orb: posture
            if (b.cdmg && e.type === 'boss') damageBoss(s, e, b.cdmg, 'counter');
            else s.events.push({ t: 'hit', x: e.x + e.w / 2, y: e.y + e.h / 2, kind: e.type, big: true });
            if (e.state !== 'trans') addPosture(s, e, b.cpost || BOSS.posturePerDeflect);
          }
          else if (e.type === 'boss') damageBoss(s, e, b.dmg, 'gun');
          else if (CFG(e)) s.events.push({ t: 'clink', x: b.x, y: b.y }); // armored: bullets bounce
          else { e.hp -= b.dmg; e.vx += Math.sign(b.vx) * 1.5; s.events.push({ t: 'hit', ...center(e), kind: e.type }); }
          b.life = 0;
        }
      } else {
        for (const p of s.players) if (b.life > 0 && b.refl && p.parry > 0 && overlap(pt, { x: p.x - 16, y: p.y - 16, w: p.w + 32, h: p.h + 32 })) {
          const tgt = s.enemies.find(e => e.id === b.src) || s.enemies[0];
          const a = tgt ? Math.atan2(tgt.y + tgt.h / 2 - b.y, tgt.x + tgt.w / 2 - b.x) : Math.atan2(-b.vy, -b.vx);
          Object.assign(b, { team: 'p', ctr: true, refl: false, home: 0, dmg: 30, vx: Math.cos(a) * 13, vy: Math.sin(a) * 13, life: 90 });
          p.parryCd = 0; // chain deflects like Sekiro
          s.events.push({ t: 'parry', x: b.x, y: b.y, deflect: true });
        }
        if (b.team === 'e') for (const p of s.players) if (b.life > 0 && p.inv === 0 && overlap(pt, p)) { hit(s, p, 'bullet'); b.life = 0; }
      }
    }
    s.bullets = s.bullets.filter(b => b.life > 0);

    // Timed bombs: shoot them `need` times before the timer runs out, or the whole arena takes the blast.
    for (const k of s.bombs) {
      const owner = s.enemies.find(e => e.id === k.src), boss = owner && owner.type === 'boss' ? owner : null;
      k.vx *= k.ground ? 0.8 : 1; moveBody(k, false); k.timer--;
      if (k.hits <= 0) {
        s.events.push({ t: 'defuse', x: k.x + 10, y: k.y + 10 });
        if (boss) { if (boss.state !== 'stagger') boss.posture = Math.min(BOSS.postureMax - 1, boss.posture + 15); damageBoss(s, boss, 15, 'counter'); }
        k.timer = -1;
      } else if (k.timer <= 0) { // firework: radial burst, then each orb turns and chases the nearest player
        const F = BOSS.firework[boss ? boss.ph : 0];
        for (let i = 0; i < F.n; i++) {
          const a = (i / F.n) * Math.PI * 2 - Math.PI / 2;
          s.bullets.push({ x: k.x + 10, y: k.y + 10, vx: Math.cos(a) * F.speed * 1.6, vy: Math.sin(a) * F.speed * 1.6,
            dmg: 0, team: 'e', life: F.home + 120, refl: true, sp: F.speed, delay: 18, home: F.home, src: k.src });
        }
        s.events.push({ t: 'boom', x: k.x + 10, y: k.y + 10, n: F.n });
        k.timer = -1;
      }
    }
    s.bombs = s.bombs.filter(k => k.timer >= 0);

    for (const e of s.enemies) if (e.hp <= 0) {
      dropLoot(s, e);
      s.events.push({ t: 'die', kind: e.type, ...center(e) });
    }
    s.enemies = s.enemies.filter(e => e.hp > 0);

    for (const k of s.pickups) {
      k.vx = 0; moveBody(k, false); k.life--;
      for (const p of s.players) if (k.life > 0 && overlap(k, p)) { collect(s, p, k); k.life = 0; }
    }
    s.pickups = s.pickups.filter(k => k.life > 0);

    // Execute: close to a staggered boss, one press = flat big damage and the stagger ends.
    s.players.forEach((p, i) => {
      const inp = inputs[i] || {};
      const b = inp.execute && !p.prevExec && s.enemies.find(e => CFG(e) && e.state === 'stagger' &&
          Math.hypot(e.x + e.w / 2 - (p.x + p.w / 2), e.y + e.h / 2 - (p.y + p.h / 2)) <= BOSS.executeRange);
      if (b) {
        s.events.push({ t: 'execute', x: b.x + b.w / 2, y: b.y + b.h / 2, kind: b.type });
        if (b.type === 'boss') damageBoss(s, b, BOSS.execute, 'flat'); else b.hp = 0; // duelists die to one execute
        if (b.state === 'stagger') { b.state = 'recover'; b.t = 50; b.posture = 0; }
        if (b.hp <= 0) { dropLoot(s, b); s.enemies = s.enemies.filter(e => e !== b); s.events.push({ t: 'die', kind: b.type, x: b.x + b.w / 2, y: b.y + b.h / 2 }); }
      }
      p.prevExec = !!inp.execute;
    });
    if (s.restart) restart(s);
    return s;
  }

  const KB = { SHOULDER, BARREL, GUNNER, W, H, FLOOR_Y, PLATFORMS, WEAPONS, ENEMIES, WAVES, BOSS, DODGE, LIVES, init, step, rand, spawnBoss };
  if (typeof module !== 'undefined') module.exports = KB; else root.KB = KB;
})(this);
