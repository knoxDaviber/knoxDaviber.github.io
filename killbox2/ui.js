'use strict';
// Menus, pause, settings, key remapping. Loaded before the game script; everything here is render/input only (no sim state).

// --- settings (saved in this browser)
const SETTINGS_KEY = 'killbox2.settings';
const DEFAULT_BINDS = { left: ['KeyA', ''], right: ['KeyD', ''], jump: ['KeyW', 'Space'], down: ['KeyS', ''], shoot: ['Mouse0', ''],
  parry: ['Mouse2', 'KeyF'], dodge: ['ShiftLeft', 'KeyC'], execute: ['KeyE', 'KeyV'], swap: ['KeyQ', ''] };
const ACTIONS = [['left', 'Move left'], ['right', 'Move right'], ['jump', 'Jump'], ['down', 'Drop down'], ['shoot', 'Shoot'],
  ['parry', 'Parry'], ['dodge', 'Dodge'], ['execute', 'Execute'], ['swap', 'Swap weapon']];
const DEFAULTS = { volume: 70, muted: false, shake: 100, flashes: true, motionBlur: true, outlines: true, music: 60, quality: 'high', tutorial: true, autoPause: true, opening: 'drawn' };
const copyBinds = b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.slice()]));
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (_) { /* private window or bad data: use defaults */ }
  const binds = copyBinds(DEFAULT_BINDS);
  for (const a in binds) if (Array.isArray(saved.binds && saved.binds[a])) binds[a] = [saved.binds[a][0] || '', saved.binds[a][1] || ''];
  return { ...DEFAULTS, ...saved, binds };
}
const cfg = loadSettings();
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch (_) { /* not saved this session */ } }

function codeName(c) {
  if (!c) return '—';
  const mouse = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' };
  if (mouse[c]) return mouse[c];
  const arrows = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  if (arrows[c]) return arrows[c];
  return c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/(Left|Right)$/, ' $1').replace('Shift Left', 'Shift').replace('Control Left', 'Ctrl').replace('Alt Left', 'Alt');
}
const keyLabel = a => cfg.binds[a].filter(Boolean).map(codeName).join(' / ') || 'unbound';
const actionHeld = a => cfg.binds[a].some(c => c && keys[c]);

// --- screens. mode: menu | play | pause | over. panel: what the overlay shows.
const uiEl = document.getElementById('ui');
let mode = 'menu', panel = 'menu', dirty = true, capture = null, settingsTab = 'general', swallowClick = false;
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in props) { if (k === 'class') el.className = props[k]; else if (k.startsWith('on')) el.addEventListener(k.slice(2), props[k]); else el[k] = props[k]; }
  el.append(...kids.filter(x => x !== null && x !== undefined)); return el;
}
const button = (label, fn, cls = '') => h('button', { class: cls, type: 'button', onclick: fn }, label);
function confirmButton(label, fn) { // run-ending buttons need a second click
  let armed = false, timer = 0;
  const b = button(label, () => {
    if (armed) { clearTimeout(timer); fn(); return; }
    armed = true; b.textContent = 'Lose this run?'; b.classList.add('warn');
    timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('warn'); }, 2600);
  });
  return b;
}
function slider(label, key, after) {
  const out = h('span', { class: 'val' }, cfg[key] + '%');
  const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: cfg[key], 'aria-label': label, oninput: () => { cfg[key] = +input.value; out.textContent = cfg[key] + '%'; saveSettings(); if (after) after(); } });
  input.setAttribute('aria-label', label);
  return h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'ctl' }, input, out));
}
function toggle(label, key, after) {
  const b = button(cfg[key] ? 'On' : 'Off', () => { cfg[key] = !cfg[key]; b.textContent = cfg[key] ? 'On' : 'Off'; b.classList.toggle('on', cfg[key]); saveSettings(); if (after) after(); }, 'tog' + (cfg[key] ? ' on' : ''));
  return h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'ctl' }, b));
}
function fullscreenRow() {
  const b = button(document.fullscreenElement ? 'On' : 'Off', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) { /* browser refused */ }
    b.textContent = document.fullscreenElement ? 'On' : 'Off'; b.classList.toggle('on', !!document.fullscreenElement);
  }, 'tog' + (document.fullscreenElement ? ' on' : ''));
  return h('div', { class: 'row' }, h('label', {}, 'Fullscreen'), h('span', { class: 'ctl' }, b));
}
function qualityRow() {
  const name = () => cfg.quality === 'high' ? 'High' : 'Performance';
  const b = button(name(), () => { cfg.quality = cfg.quality === 'high' ? 'low' : 'high'; b.textContent = name(); saveSettings(); fit(); dirty = true; }, 'tog on');
  return h('div', { class: 'row' }, h('label', {}, 'Graphics'), h('span', { class: 'ctl' }, b));
}
function openingRow() { // which KITE falls through the title; it changes behind the panel at once
  const name = () => cfg.opening === 'chunky' ? 'Chunky' : 'Drawn';
  const b = button(name(), () => { cfg.opening = cfg.opening === 'chunky' ? 'drawn' : 'chunky'; b.textContent = name(); saveSettings(); }, 'tog on');
  return h('div', { class: 'row' }, h('label', {}, 'Opening KITE'), h('span', { class: 'ctl' }, b));
}
function generalTab() {
  return [h('h3', {}, 'Audio'), slider('Volume', 'volume', applyVolume), slider('Music', 'music', applyVolume), toggle('Mute', 'muted', applyVolume),
    h('h3', {}, 'Display'), fullscreenRow(), qualityRow(), slider('Screen shake', 'shake'), toggle('Screen flashes', 'flashes'), toggle('Motion blur (afterimages)', 'motionBlur'), toggle('Enemy outlines', 'outlines'), openingRow(),
    h('h3', {}, 'Gameplay'), toggle('Tutorial signs', 'tutorial', () => { if (typeof s !== 'undefined') s.hold = false; }), toggle('Pause when window loses focus', 'autoPause')];
}
function controlsTab() {
  const grid = h('div', { class: 'binds' }, h('span', { class: 'head' }, 'Action'), h('span', { class: 'head' }, 'Key'), h('span', { class: 'head' }, 'Alternate'));
  for (const [a, name] of ACTIONS) {
    grid.append(h('span', {}, name));
    for (const i of [0, 1]) {
      const waiting = capture && capture.a === a && capture.i === i;
      grid.append(button(waiting ? 'Press a key…' : codeName(cfg.binds[a][i]), () => { capture = { a, i }; show('settings'); }, 'bind' + (waiting ? ' wait' : '')));
    }
  }
  return [grid, h('p', { class: 'note' }, 'Click a slot, then press a key or mouse button. Esc cancels. The mouse wheel also swaps weapons.'),
    button('Reset controls', () => { cfg.binds = copyBinds(DEFAULT_BINDS); capture = null; saveSettings(); show('settings'); })];
}
function settingsPanel() {
  const tab = (id, label) => button(label, () => { capture = null; settingsTab = id; show('settings'); }, 'tab' + (settingsTab === id ? ' active' : ''));
  return h('div', { class: 'panel wide' }, h('h2', {}, 'Settings'), h('div', { class: 'tabs' }, tab('general', 'General'), tab('controls', 'Controls')),
    h('div', { class: 'scroll' }, ...(settingsTab === 'general' ? generalTab() : controlsTab())),
    button('Back', backFromSettings, 'primary'));
}
const PANELS = {
  menu: () => h('div', { class: 'home' }, h('h1', {}, 'KILLBOX', h('b', {}, '2')), h('div', { class: 'stack' },
    button('Play', playFromTitle, 'primary'), button('Settings', () => show('settings')))),
  pause: () => h('div', { class: 'panel' }, h('h2', {}, 'Paused'), h('div', { class: 'stack' }, button('Resume', resumeGame, 'primary'),
    button('Settings', () => show('settings')), confirmButton('Restart', startGame), confirmButton('Main menu', toMenu))),
  over: () => {
    const won = s.phase === 'clear';
    return h('div', { class: 'panel' }, h('h2', { class: won ? 'win' : 'lose' }, won ? 'Arena clear' : 'You died'),
      h('p', { class: 'note' }, won ? (ashAt >= 0 ? 'Not a life lost to VULKARN. Even his ash is gone.' : 'VULKARN is slag.') : s.phase === 'dead' && s.enemies.some(e => e.type === 'boss') ? 'Fell to VULKARN.' : 'Fell on wave ' + Math.max(1, s.wave) + ' of ' + KB.WAVES.length + '.'),
      h('div', { class: 'stack' }, button(won ? 'Play again' : 'Try again', () => startGame(), 'primary'), button('Main menu', toMenu)));
  },
  settings: settingsPanel
};
function show(name) {
  panel = name; uiEl.classList.remove('torn'); uiEl.replaceChildren(PANELS[name]()); uiEl.hidden = false;
  uiEl.classList.toggle('dim', mode !== 'menu');
  const wait = uiEl.querySelector('.wait'), first = uiEl.querySelector('.primary');
  if (wait) wait.focus({ preventScroll: true }); else if (first && name !== 'settings') first.focus({ preventScroll: true });
}
// the mouse is captured during play; pausing (or Esc, which the browser always allows) frees it
let freedAt = -1e9;
function grabMouse() { // refused without a click, or for about a second after Esc: the next click in the arena tries again
  if (document.pointerLockElement === cv || !cv.requestPointerLock) return;
  try { Promise.resolve(cv.requestPointerLock()).catch(() => {}); } catch (_) { /* play on uncaptured */ }
}
function freeMouse() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { if (mode !== 'play' && mode !== 'drop') freeMouse(); return; } // granted after the player had already paused
  if (mode === 'play' && (cfg.autoPause || document.hasFocus())) { freedAt = performance.now(); pauseGame(); }
});
function releaseInput() { for (const k in keys) delete keys[k]; }
function hideMenu() { uiEl.classList.remove('torn'); uiEl.hidden = true; uiEl.replaceChildren(); }
function startGame() { releaseInput(); restart(); hideMenu(); audio(); grabMouse(); startDrop(false); } // again: straight to the landing
function playFromTitle() { releaseInput(); restart(); audio(); grabMouse(); uiEl.classList.add('torn'); startDrop(true); } // the menu is torn away as he drops
function resumeGame() { releaseInput(); mode = 'play'; uiEl.hidden = true; uiEl.replaceChildren(); grabMouse(); }
function pauseGame() { if (mode !== 'play') return; releaseInput(); mode = 'pause'; freeMouse(); dirty = true; show('pause'); }
function gameOver() { releaseInput(); mode = 'over'; freeMouse(); dirty = true; show('over'); }
function toMenu() { releaseInput(); restart(); mode = 'menu'; freeMouse(); show('menu'); }
function backFromSettings() { capture = null; show(mode === 'menu' ? 'menu' : mode === 'over' ? 'over' : 'pause'); }

// --- rebinding and menu keys
function bindCapture(code) {
  const { a, i } = capture;
  for (const x in cfg.binds) cfg.binds[x] = cfg.binds[x].map(c => c === code ? '' : c); // a key does one job
  cfg.binds[a][i] = code; capture = null; saveSettings(); show('settings');
}
function uiKey(e) { // returns true when the key belongs to the UI
  if (capture) { e.preventDefault(); if (e.repeat) return true; if (e.code === 'Escape') { capture = null; show('settings'); } else bindCapture(e.code); return true; }
  const taken = Object.values(cfg.binds).some(b => b.includes(e.code));
  if (mode === 'drop') { e.preventDefault(); if (!e.repeat) skipDrop(); return true; }
  if (mode === 'play') {
    if (!e.repeat && (e.code === 'Escape' || (e.code === 'KeyP' && !taken))) { e.preventDefault(); pauseGame(); return true; }
    if (!e.repeat) skipPage();
    if (taken || e.code === 'Space') e.preventDefault();
    return false;
  }
  if (e.code === 'Escape' && (e.repeat || performance.now() - freedAt < 200)) return true; // the Esc that freed the mouse must not also resume
  if (e.code === 'Escape') {
    if (panel === 'settings') backFromSettings(); else if (mode === 'pause') resumeGame();
    return true;
  }
  if (e.code === 'KeyP' && mode === 'pause' && panel === 'pause') { resumeGame(); return true; }
  if (e.code === 'KeyR' && mode === 'over') { startGame(); return true; }
  if (['ArrowUp', 'ArrowDown'].includes(e.code)) {
    const list = [...uiEl.querySelectorAll('button, input')], at = list.indexOf(document.activeElement), d = e.code === 'ArrowDown' ? 1 : -1;
    if (list.length) { e.preventDefault(); list[(at + d + list.length) % list.length].focus(); }
  }
  return true;
}
addEventListener('mousedown', e => { if (capture) { e.preventDefault(); e.stopPropagation(); swallowClick = true; bindCapture('Mouse' + e.button); } }, true);
addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
addEventListener('blur', () => { if (cfg.autoPause) pauseGame(); else releaseInput(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) pauseGame(); if (panel === 'settings' && !uiEl.hidden) show('settings'); });
function uiFit(k, top, left) { // overlay matches the canvas; em units scale with it
  uiEl.style.cssText = `left:${left}px;top:${top}px;width:${KB.W * k}px;height:${KB.H * k}px;font-size:${16 * k}px`;
}
