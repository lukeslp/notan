/* Notan: the page. Builds the board as an ARIA grid (column clues are column
 * headers, row clues are row headers), handles tap / drag / long-press /
 * keyboard input, saves progress, and plays the solved reveal.
 * Needs engine.js (window.InkEngine) and levels.js (window.InkLevels). */
(function () {
  'use strict';
  const E = window.InkEngine;
  const LEVELS = window.InkLevels;
  const PLUS_LEVELS = window.InkPlusLevels;
  const SIZES = [5, 8, 10, 12, 15];
  const BLANK = 0, INK = 1, MARK = 2;
  const STATE = ['blank', 'filled', 'marked empty'];
  const KEY = 'ink.v1'; // the game was called Ink until 2026-10-04; the key stays so progress carries over
  const HOLD_MS = 380, DOUBLE_MS = 300;
  const $ = (s) => document.querySelector(s);

  /* ---------- storage (everything optional; private mode just doesn't save) ---------- */
  function readSave() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }
  const raw = readSave();
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const save = {
    at: typeof raw.at === 'string' ? raw.at : null,
    solved: obj(raw.solved),
    boards: obj(raw.boards),
    endless: raw.endless && typeof raw.endless === 'object' ? raw.endless : null,
    seen: !!raw.seen,
    mark: !!raw.mark,
    quickSize: SIZES.includes(raw.quickSize) ? raw.quickSize : 10,
    zoom: [100, 115, 130, 150].includes(raw.zoom) ? raw.zoom : 100,
    theme: ['light', 'dark'].includes(raw.theme) ? raw.theme : 'system',
  };
  // Redraws keep completion credit, but old cells cannot describe the new art.
  const migrations = {
    leaf: 'leaf-connected', boat: 'boat-sail', goggles: 'goggles-bold',
    alien: 'alien-bold', robot: 'robot-bold',
    jellyfish: 'jellyfish-drift', mountain: 'mountain-ridge', crab: 'crab-raised',
    lion: 'lion-profile', beetle: 'beetle-angled',
    'alien-bold': 'alien-antenna', 'goggles-bold': 'goggles-tilted', 'robot-bold': 'robot-wave',
  };
  for (const [oldId, newId] of Object.entries(migrations)) {
    if (Object.prototype.hasOwnProperty.call(save.solved, oldId)) {
      if (!Object.prototype.hasOwnProperty.call(save.solved, newId)) save.solved[newId] = save.solved[oldId];
      delete save.solved[oldId];
    }
    delete save.boards[oldId];
    if (save.at === oldId) save.at = newId;
  }
  save.plusUnlocked = raw.plusUnlocked === true || typeof save.solved[LEVELS[LEVELS.length - 1].id] === 'number';
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: play on */ }
  }

  /* ---------- puzzles ---------- */
  const puzzles = (list, plus = false) => list.map((L, index) => {
    const { w, h, sol } = E.fromArt(L.art);
    const { rows, cols } = E.cluesOf(sol, w, h);
    return { id: L.id, name: L.name, index, plus, w, h, sol, rows, cols };
  });
  const RAMP = puzzles(LEVELS), PLUS = puzzles(PLUS_LEVELS, true);
  const sequence = (p) => p.plus ? PLUS : RAMP;
  function newSeed() { return 1 + Math.floor(Math.random() * 99999); }
  function endless(size, seed) {
    for (let s = seed, tries = 0; tries < 20; s++, tries++) {
      const g = E.generate(s, size, size);
      if (g) return { id: 'endless', name: 'No. ' + s, endless: true, size, seed: s, w: size, h: size, sol: g.sol, rows: g.rows, cols: g.cols };
    }
    return null;
  }

  /* ---------- state + elements ---------- */
  const S = {
    puz: null, cells: null, undo: [], locks: { row: [], col: [] }, solved: false, solvedAt: 0,
    time: 0, focus: 0, mark: save.mark, drag: null, pending: null,
    lastTap: null, kbd: false, geo: null, lastTo: null,
  };
  const board = $('#board'), grid = $('#grid'), bandR = $('.band-r'), bandC = $('.band-c');
  const cursor = $('.cursor'), caption = $('#caption'), capName = $('#cap-name'), nextBtn = $('#next-btn');
  const lvlBtn = $('#lvl-btn'), lvlText = $('#lvl-text'), clock = $('#clock'), live = $('#live');
  const undoBtn = $('#undo-btn'), modeBtn = $('#mode-btn'), helpBtn = $('#help-btn');
  const shareBtn = $('#share-btn');
  const help = $('#help'), levels = $('#levels'), lvGrid = $('#lv-grid'), lvMeta = $('#lv-meta'), sizesEl = $('#sizes');
  const settings = $('#settings'), settingsBtn = $('#settings-btn');
  const resetConfirm = $('#reset-confirm');
  const plusSection = $('#plus-section'), plusGrid = $('#plus-grid'), unlockNotice = $('#unlock-notice');
  const dialogs = [help, levels, settings, resetConfirm];
  const modalOpen = () => dialogs.some((dlg) => dlg.open);
  let cellEls = [], rowHeads = [], colHeads = [];
  let finishTimer = 0;

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  let liveTimer = 0;
  function announce(text) {
    clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = setTimeout(() => { live.textContent = text; }, 40);
  }
  function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function label(p) { return p.endless ? 'Endless ' + p.size + ' by ' + p.size : (p.plus ? 'New Game+ level ' : 'Level ') + (p.index + 1); }

  /* ---------- open a puzzle ---------- */
  /* First visit, level 1, nothing touched: after a few quiet seconds one square
   * shows a faint fill growing and fading, which is what a tap does. No words;
   * it goes at the first move. */
  let nudgeTimer = 0;
  function clearNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = 0;
    const n = grid.querySelector('.cell.nudge');
    if (n) n.classList.remove('nudge');
  }
  function scheduleNudge() {
    clearNudge();
    const fresh = () => S.puz && S.puz.id === RAMP[0].id && !S.solved && !S.cells.some((v) => v) && !Object.keys(save.solved).length;
    if (!fresh()) return;
    nudgeTimer = setTimeout(() => { if (fresh() && !modalOpen() && cellEls[0]) cellEls[0].classList.add('nudge'); }, 3000);
  }

  function open(puz) {
    if (!puz) return;
    stopClock();
    clearTimeout(finishTimer);
    S.puz = puz;
    S.undo = [];
    S.lastTap = null;
    cancelClueHold();
    S.locks = { row: Array(puz.h).fill(false), col: Array(puz.w).fill(false) };
    S.solved = false;
    S.drag = null;
    if (S.pending) { clearTimeout(S.pending.timer); S.pending = null; }
    S.lastTo = null;
    const n = puz.w * puz.h;
    S.cells = new Int8Array(n);
    S.time = 0;
    const saved = puz.endless
      ? (save.endless && save.endless.size === puz.size && save.endless.seed === puz.seed ? save.endless : null)
      : save.boards[puz.id];
    if (saved && typeof saved.c === 'string' && saved.c.length === n) {
      for (let i = 0; i < n; i++) { const v = saved.c.charCodeAt(i) - 48; S.cells[i] = v === 1 || v === 2 ? v : 0; }
      S.time = Math.max(0, saved.t | 0);
      for (const kind of ['row', 'col']) {
        const locks = saved.locks && saved.locks[kind];
        S.locks[kind] = S.locks[kind].map((_, i) => Array.isArray(locks) && locks[i] === true);
      }
    }
    if (puz.endless) {
      save.quickSize = puz.size;
      save.at = 'endless';
      save.endless = { size: puz.size, seed: puz.seed, c: Array.from(S.cells).join(''), t: S.time, locks: S.locks };
    } else save.at = puz.id;
    persist();
    renderQuickChoices();

    // If focus was on the old board or its Next button, keep it on the board.
    const refocus = caption.contains(document.activeElement) || grid.contains(document.activeElement);
    // Drop the solved state without animating the new board in from the old offset.
    board.classList.add('instant');
    board.classList.remove('solved');
    caption.classList.remove('show');
    caption.hidden = true;
    unlockNotice.hidden = true;
    build();
    layout();
    renderAll();
    hud();
    setUrl();
    void board.offsetWidth;
    board.classList.remove('instant');
    if (refocus) setFocus(0, true);
    if (isSolved()) finish(true);
    else scheduleNudge();
  }

  function build() {
    const { w, h, rows, cols } = S.puz;
    grid.textContent = '';
    cellEls = new Array(w * h);
    rowHeads = [];
    colHeads = [];
    grid.setAttribute('aria-label', label(S.puz) + ', ' + w + ' by ' + h + ' squares');
    grid.setAttribute('aria-rowcount', String(h + 1));
    grid.setAttribute('aria-colcount', String(w + 1));
    const head = el('div', 'gr');
    head.setAttribute('role', 'row');
    const corner = el('div', 'corner');
    corner.setAttribute('role', 'columnheader');
    corner.innerHTML = '<span class="sr-only">Row clues</span>';
    head.append(corner);
    cols.forEach((clue) => { const d = clueEl('cc', clue); d.setAttribute('role', 'columnheader'); colHeads.push(d); head.append(d); });
    grid.append(head);
    const guides = w > 5 || h > 5;
    for (let r = 0; r < h; r++) {
      const gr = el('div', 'gr');
      gr.setAttribute('role', 'row');
      const rh = clueEl('rc', rows[r]);
      rh.setAttribute('role', 'rowheader');
      rowHeads.push(rh);
      gr.append(rh);
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        const d = el('div', 'cell');
        d.setAttribute('role', 'gridcell');
        d.tabIndex = -1;
        if (r === 0) d.classList.add('t');
        if (c === 0) d.classList.add('l');
        if (c === w - 1) d.classList.add('rt');
        if (r === h - 1) d.classList.add('bt');
        if (guides && c < w - 1 && (c + 1) % 5 === 0) d.classList.add('gx');
        if (guides && r < h - 1 && (r + 1) % 5 === 0) d.classList.add('gy');
        cellEls[i] = d;
        gr.append(d);
      }
      grid.append(gr);
    }
    S.focus = 0;
    cellEls[0].tabIndex = 0;
  }
  function clueEl(kind, clue) {
    const d = el('div', 'clue ' + kind);
    (clue.length ? clue : [0]).forEach((n) => { const s = el('span'); s.textContent = String(n); d.append(s); });
    return d;
  }

  /* ---------- layout: the largest cell that fits between the readout and the icons ---------- */
  function fontFor(cell) { return Math.max(10, Math.min(15, Math.round(cell * 0.42))) * save.zoom / 100; }
  function layout() {
    if (!S.puz) return;
    const { w, h, rows, cols } = S.puz;
    // clientWidth/Height, not innerWidth: on phones innerWidth reports the
    // overflowed width while a new board is still at its default size.
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const narrow = vw < 560;
    const top = narrow ? 52 : 60, bottom = narrow ? 66 : 74, gut = 16;
    const W = vw - 2 * gut, H = vh - top - bottom;
    const rowsN = rows.map((cl) => (cl.length ? cl : [0]));
    const colMax = Math.max(...cols.map((cl) => Math.max(1, cl.length)));
    let g = null;
    for (let s = 72; s >= 8; s--) {
      const f = fontFor(s);
      const cw = Math.ceil(Math.max(...rowsN.map((cl) => cl.reduce((a, n) => a + String(n).length * 0.62 * f, 0) + (cl.length - 1) * 0.5 * f)) + 0.85 * f);
      const ch = Math.ceil(colMax * 1.18 * f + 0.55 * f);
      g = { cell: s, f, cw, ch };
      if (cw + w * s <= W && ch + h * s <= H) break;
    }
    const bw = g.cw + w * g.cell, bh = g.ch + h * g.cell;
    g.left = Math.round((vw - bw) / 2);
    g.top = Math.round(top + Math.max(0, (H - bh) / 2));
    S.geo = g;
    // Where the picture goes once solved: smaller, centered with its name
    // under it, so it sits on the page like a print with room around it.
    const capH = caption.hidden ? 122 * save.zoom / 100 : Math.max(122, caption.offsetHeight);
    const k = Math.min(1, ((H - capH) * 0.72) / (h * g.cell), (W * 0.8) / (w * g.cell));
    const pw = w * g.cell * k, ph = h * g.cell * k;
    const tx = (vw - pw) / 2, ty = top + Math.max(0, (H - ph - capH) / 2);
    const dx = Math.round(tx - g.left - k * g.cw), dy = Math.round(ty - g.top - k * g.ch);
    board.style.cssText = `--cell:${g.cell}px;--f:${g.f}px;--cw:${g.cw}px;--ch:${g.ch}px;--dot:${Math.max(3, Math.round(g.cell * 0.16))}px;--solved:translate(${dx}px,${dy}px) scale(${k.toFixed(4)});left:${g.left}px;top:${g.top}px;width:${bw}px;height:${bh}px`;
    caption.style.top = Math.round(ty + ph + 14) + 'px';
    showBands(S.bandAt == null ? -1 : S.bandAt);
    placeCursor();
  }

  /* ---------- rendering ---------- */
  function renderCell(i) {
    const v = S.cells[i], d = cellEls[i], w = S.puz.w;
    d.classList.toggle('ink', v === INK);
    d.classList.toggle('mark', v === MARK);
    d.setAttribute('aria-readonly', String(isLocked(i)));
    d.setAttribute('aria-label', 'Row ' + (Math.floor(i / w) + 1) + ', column ' + (i % w + 1) + ': ' + STATE[v] + (isLocked(i) ? ', locked' : ''));
  }
  function lineOf(kind, k) {
    const { w, h } = S.puz;
    const out = [];
    if (kind === 'row') for (let c = 0; c < w; c++) out.push(S.cells[k * w + c]);
    else for (let r = 0; r < h; r++) out.push(S.cells[r * w + k]);
    return out;
  }
  /* Returns true when the line matches its clue. */
  /* A line's clue dims when its filled runs match it; before that, each number
   * fades on its own once its run is finished and closed off (E.doneClues reads
   * the board, never the solution). A number that just finished pops once. */
  function lineStatus(kind, k, animate) {
    const clue = kind === 'row' ? S.puz.rows[k] : S.puz.cols[k];
    const head = kind === 'row' ? rowHeads[k] : colHeads[k];
    const line = lineOf(kind, k);
    const cells = line.map((v) => (v === INK ? 1 : v === MARK ? 0 : -1));
    const ok = E.same(E.runs(line), clue);
    const bad = !ok && E.solveLine(cells, clue) === null;
    const parts = clue.length ? E.doneClues(cells, clue) : [ok];
    let count = 0;
    Array.from(head.children).forEach((n, i) => {
      const done = ok || parts[i];
      if (done) count++;
      if (animate && done && !n.classList.contains('n-done')) pop(n);
      n.classList.toggle('n-done', done);
    });
    head.classList.toggle('locked', S.locks[kind][k]);
    head.classList.toggle('ok', ok);
    head.classList.toggle('bad', bad);
    const name = (kind === 'row' ? 'Row ' : 'Column ') + (k + 1) + (S.locks[kind][k] ? ', locked' : ', unlocked') + ', clue ' + (clue.length ? clue.join(' ') : '0');
    head.setAttribute('aria-label', name + (ok ? ', done' : bad ? ', cannot fit as marked' : count ? ', ' + count + ' of ' + clue.length + ' numbers done' : ''));
    return ok;
  }
  function pop(n) {
    n.classList.remove('pop');
    void n.offsetWidth;
    n.classList.add('pop');
    n.addEventListener('animationend', () => n.classList.remove('pop'), { once: true });
  }
  function renderAll() {
    for (let i = 0; i < S.cells.length; i++) renderCell(i);
    for (let r = 0; r < S.puz.h; r++) lineStatus('row', r);
    for (let c = 0; c < S.puz.w; c++) lineStatus('col', c);
    hud();
  }
  /* Re-check the rows and columns that touch these cells; returns the
   * names of lines that just became done (for the screen-reader note). */
  function updateLines(idx) {
    const w = S.puz.w;
    const rs = new Set(), cs = new Set();
    idx.forEach((i) => { rs.add(Math.floor(i / w)); cs.add(i % w); });
    const done = [];
    rs.forEach((r) => { const was = rowHeads[r].classList.contains('ok'); if (lineStatus('row', r, true) && !was) done.push('row ' + (r + 1)); });
    cs.forEach((c) => { const was = colHeads[c].classList.contains('ok'); if (lineStatus('col', c, true) && !was) done.push('column ' + (c + 1)); });
    return done;
  }
  function isSolved() {
    for (let r = 0; r < S.puz.h; r++) if (!E.same(E.runs(lineOf('row', r)), S.puz.rows[r])) return false;
    for (let c = 0; c < S.puz.w; c++) if (!E.same(E.runs(lineOf('col', c)), S.puz.cols[c])) return false;
    return true;
  }
  function hud() {
    const p = S.puz;
    lvlText.textContent = p.endless ? '∞ ' + p.size : (p.plus ? '+' : '') + String(p.index + 1);
    lvlBtn.setAttribute('aria-label', (p.endless ? 'Endless, ' + p.size + ' by ' + p.size : label(p) + ' of ' + sequence(p).length) + '. Choose a level');
    clock.textContent = fmt(S.time);
    undoBtn.setAttribute('aria-disabled', S.undo.length && !S.solved ? 'false' : 'true');
    modeBtn.setAttribute('aria-pressed', S.mark ? 'true' : 'false');
    modeBtn.querySelector('.m-fill').style.display = S.mark ? 'none' : '';
    modeBtn.querySelector('.m-dot').style.display = S.mark ? '' : 'none';
  }

  /* ---------- clock ---------- */
  let tick = null;
  function startClock() {
    clearNudge();
    if (tick || S.solved) return;
    tick = setInterval(() => {
      if (document.hidden) return;
      S.time++;
      clock.textContent = fmt(S.time);
      if (S.time % 10 === 0) storeBoard();
    }, 1000);
  }
  function stopClock() { clearInterval(tick); tick = null; }

  function storeBoard() {
    if (!S.puz || S.solved) return;
    const c = Array.from(S.cells).join('');
    const blank = !S.cells.some((v) => v);
    if (S.puz.endless) save.endless = { size: S.puz.size, seed: S.puz.seed, c, t: S.time, locks: S.locks };
    else if (blank && !S.time && !S.locks.row.some(Boolean) && !S.locks.col.some(Boolean)) delete save.boards[S.puz.id];
    else save.boards[S.puz.id] = { c, t: S.time, locks: S.locks };
    persist();
  }

  function isLocked(i) {
    return S.locks.row[Math.floor(i / S.puz.w)] || S.locks.col[i % S.puz.w];
  }
  function toggleLock(kind, k) {
    S.lastTap = null;
    if (S.solved || S.drag || S.pending) return;
    S.locks[kind][k] = !S.locks[kind][k];
    clearNudge();
    renderAll();
    storeBoard();
    announce((kind === 'row' ? 'Row ' : 'Column ') + (k + 1) + (S.locks[kind][k] ? ', locked' : ', unlocked'));
  }

  /* ---------- moves ---------- */
  /* Two plain toggles, no cycling: a tap fills or clears; a hold or right-click marks or clears.
   * Mark mode swaps them. Filling a marked square (or marking a filled one) replaces it. */
  const toggleInk = (v) => (v === INK ? BLANK : INK);
  const toggleMark = (v) => (v === MARK ? BLANK : MARK);
  function tapOf(v) { return S.mark ? toggleMark(v) : toggleInk(v); }
  function altOf(v) { return S.mark ? toggleInk(v) : toggleMark(v); }

  function pushUndo(snap) {
    S.undo.push(snap);
    if (S.undo.length > 400) S.undo.shift();
  }
  function afterChange(idx, speak) {
    const done = updateLines(idx);
    storeBoard();
    hud();
    clearTimeout(finishTimer);
    if (isSolved()) {
      // Keep the final fill immediate, but allow its second tap before revealing.
      if (S.lastTap) finishTimer = setTimeout(() => { if (!S.drag && isSolved()) finish(false); }, DOUBLE_MS);
      else finish(false);
      return;
    }
    if (speak) announce(speak + (done.length ? '. ' + done.join(' and ') + ' done' : ''));
  }

  /* A single keyboard move. */
  function act(i, to) {
    S.lastTap = null;
    if (S.solved || isLocked(i) || S.cells[i] === to) return;
    pushUndo(Int8Array.from(S.cells));
    S.cells[i] = to;
    S.lastTo = to;
    startClock();
    renderCell(i);
    afterChange([i], to === BLANK ? 'cleared' : STATE[to]);
  }

  /* One snapshot per path; a second tap revises the first tap's transaction. */
  function begin(i, kind, e) {
    if (S.solved || isLocked(i)) return;
    clearTimeout(finishTimer);
    const last = S.lastTap;
    const double = kind === 'tap' && last && last.i === i &&
      performance.now() - last.time <= DOUBLE_MS && S.undo.at(-1) === last.snap;
    S.lastTap = null;
    const before = Int8Array.from(S.cells);
    const snap = double ? S.undo.pop() : Int8Array.from(S.cells);
    const from = snap[i];
    const to = double ? toggleMark(from) : kind === 'alt' ? altOf(from) : tapOf(from);
    S.drag = { id: e.pointerId, start: i, to, snap, before, double, painted: new Set(),
      point: pointAt(e), tap: kind === 'tap' && !double, moved: false };
    startClock();
    paintCell(i);
  }
  function paintCell(i) {
    const d = S.drag;
    if (isLocked(i)) return;
    d.painted.add(i);
    S.cells[i] = d.to;
    renderCell(i);
  }
  function pointAt(e) {
    const b = board.getBoundingClientRect(), g = S.geo;
    return { x: Math.max(0, Math.min(S.puz.w - 0.000001, (e.clientX - b.left - g.cw) / g.cell)),
      y: Math.max(0, Math.min(S.puz.h - 0.000001, (e.clientY - b.top - g.ch) / g.cell)) };
  }
  function paintTo(e) {
    const d = S.drag;
    if (!d) return;
    const a = d.point, b = pointAt(e), ts = [0, 1];
    // Split the actual pointer segment at grid boundaries. Midpoints visit
    // every crossed square, even with sparse samples or a diagonal path.
    for (const axis of ['x', 'y']) {
      const delta = b[axis] - a[axis];
      if (!delta) continue;
      for (let n = Math.floor(Math.min(a[axis], b[axis])) + 1; n < Math.max(a[axis], b[axis]); n++)
        ts.push((n - a[axis]) / delta);
    }
    ts.sort((x, y) => x - y);
    const visit = t => {
      const i = Math.floor(a.y + (b.y - a.y) * t) * S.puz.w + Math.floor(a.x + (b.x - a.x) * t);
      if (i !== d.start) d.moved = true;
      paintCell(i);
      return i;
    };
    for (let n = 1; n < ts.length; n++) if (ts[n] - ts[n - 1] > 1e-10) visit((ts[n] + ts[n - 1]) / 2);
    setFocus(visit(1), false);
    d.point = b;
    updateLines([...d.painted]);
  }
  function endGesture(e) {
    const d = S.drag;
    S.drag = null;
    if (!d || !d.painted.size) return;
    if (e.type !== 'pointerup') {
      S.cells = d.before;
      if (d.double) pushUndo(d.snap);
      renderAll();
      storeBoard();
      return;
    }
    pushUndo(d.snap);
    if (e.type === 'pointerup' && d.tap && !d.moved)
      S.lastTap = { i: d.start, time: performance.now(), snap: d.snap };
    afterChange([...d.painted], null);
  }

  function undo() {
    clearTimeout(finishTimer);
    S.lastTap = null;
    if (S.solved) return;
    const snap = S.undo.pop();
    if (!snap) { announce('Nothing to undo'); return; }
    const diff = [];
    for (let i = 0; i < snap.length; i++) if (S.cells[i] !== snap[i]) diff.push(i);
    S.cells = snap;
    diff.forEach(renderCell);
    updateLines(diff);
    storeBoard();
    hud();
    announce('Undone');
  }
  function startOver() {
    clearTimeout(finishTimer);
    S.lastTap = null;
    if (S.solved) { open(S.puz); announce(label(S.puz) + ' again'); return; }
    const hadLocks = S.locks.row.some(Boolean) || S.locks.col.some(Boolean);
    S.locks.row.fill(false); S.locks.col.fill(false);
    if (!S.cells.some((v) => v) && !hadLocks) { announce('The board is already blank'); return; }
    pushUndo(Int8Array.from(S.cells));
    S.cells.fill(0);
    renderAll();
    storeBoard();
    hud();
    announce('Board cleared. Undo brings it back.');
  }

  /* ---------- solved ---------- */
  function finish(quiet) {
    S.solved = true;
    S.locks.row.fill(false); S.locks.col.fill(false);
    renderAll();
    S.solvedAt = performance.now();
    stopClock();
    const p = S.puz;
    if (p.endless) {
      save.endless = { size: p.size, seed: newSeed(), c: '', t: 0 };
    } else {
      const best = save.solved[p.id];
      save.solved[p.id] = typeof best === 'number' && best > 0 && best < S.time ? best : S.time;
      delete save.boards[p.id];
      if (!p.plus && p.index === RAMP.length - 1) save.plusUnlocked = true;
      const nx = sequence(p)[p.index + 1] || (!p.plus ? PLUS[0] : null);
      save.at = nx ? nx.id : p.id;
    }
    persist();
    showBands(-1);
    placeCursor();
    board.classList.add('solved');
    capName.textContent = p.name;
    unlockNotice.hidden = p.endless || p.plus || p.index !== RAMP.length - 1;
    shareBtn.hidden = !p.endless;
    shareBtn.textContent = 'Share blank';
    nextBtn.setAttribute('aria-label', p.endless ? 'Next board' : !p.plus && p.index === RAMP.length - 1 ? 'Start New Game+' : p.index + 1 < sequence(p).length ? 'Next level' : 'Choose what to play next');
    caption.hidden = false;
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => caption.classList.add('show')));
    hud();
    if (!quiet) announce((!unlockNotice.hidden ? 'New Game+ unlocked. ' : '') + 'Solved: ' + p.name + ', in ' + fmt(S.time) + '. Press Enter for the next one.');
    // Keyboard players land on Next; pointer players just tap anywhere.
    if (S.kbd) nextBtn.focus({ preventScroll: true });
  }
  function next() {
    const p = S.puz;
    if (p.endless) open(endless(p.size, save.endless ? save.endless.seed : newSeed()));
    else if (p.index + 1 < sequence(p).length) open(sequence(p)[p.index + 1]);
    else if (!p.plus && save.plusUnlocked) {
      open(PLUS[0]);
      announce('New Game+ unlocked. ' + label(S.puz) + ', ' + S.puz.w + ' by ' + S.puz.h);
      return;
    }
    else { openLevels(true); return; }
    announce(label(S.puz) + ', ' + S.puz.w + ' by ' + S.puz.h);
  }

  /* ---------- focus, bands, cursor ---------- */
  function setFocus(i, move) {
    if (!cellEls[i]) return;
    if (cellEls[S.focus]) cellEls[S.focus].tabIndex = -1;
    S.focus = i;
    cellEls[i].tabIndex = 0;
    if (move) cellEls[i].focus({ preventScroll: true });
    showBands(i);
    placeCursor();
  }
  function showBands(i) {
    S.bandAt = i;
    if (i < 0 || S.solved || !S.geo) { bandR.style.opacity = '0'; bandC.style.opacity = '0'; return; }
    const g = S.geo, { w, h } = S.puz;
    const r = Math.floor(i / w), c = i % w;
    bandR.style.cssText = `opacity:1;left:0;top:${g.ch + r * g.cell}px;width:${g.cw + w * g.cell}px;height:${g.cell}px`;
    bandC.style.cssText = `opacity:1;top:0;left:${g.cw + c * g.cell}px;width:${g.cell}px;height:${g.ch + h * g.cell}px`;
  }
  function placeCursor() {
    const on = S.kbd && !S.solved && S.geo && grid.contains(document.activeElement);
    cursor.classList.toggle('on', !!on);
    if (!on) return;
    const g = S.geo, w = S.puz.w;
    cursor.style.left = g.cw + (S.focus % w) * g.cell + 'px';
    cursor.style.top = g.ch + Math.floor(S.focus / w) * g.cell + 'px';
  }

  /* ---------- pointer input ---------- */
  function cellAt(x, y, clamp) {
    const b = board.getBoundingClientRect(), g = S.geo, { w, h } = S.puz;
    let c = Math.floor((x - b.left - g.cw) / g.cell), r = Math.floor((y - b.top - g.ch) / g.cell);
    if (clamp) { c = Math.max(0, Math.min(w - 1, c)); r = Math.max(0, Math.min(h - 1, r)); }
    else if (c < 0 || r < 0 || c >= w || r >= h) return -1;
    return r * w + c;
  }
  let clueHold = null, heldClue = null;
  function cancelClueHold() {
    if (clueHold) clearTimeout(clueHold.timer);
    clueHold = null;
  }
  function clueLine(target) {
    const head = target.closest('.clue');
    if (!head || !grid.contains(head)) return null;
    const kind = head.classList.contains('rc') ? 'row' : 'col';
    return { kind, k: (kind === 'row' ? rowHeads : colHeads).indexOf(head), head };
  }
  document.addEventListener('pointerdown', cancelClueHold, true);
  board.addEventListener('pointerdown', (e) => {
    if (S.solved || !S.geo) return;
    if (e.button !== 0 && e.button !== 2) return;
    const clue = clueLine(e.target);
    if (clue) {
      heldClue = null;
      if (!e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      const hold = { ...clue, id: e.pointerId, x: e.clientX, y: e.clientY };
      hold.timer = setTimeout(() => {
        clueHold = null;
        heldClue = hold.head;
        toggleLock(hold.kind, hold.k);
      }, 500);
      clueHold = hold;
      try { board.setPointerCapture(e.pointerId); } catch (_) { /* fine without capture */ }
      return;
    }
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || isLocked(i) || !e.isPrimary) return;
    e.preventDefault();
    S.kbd = false;
    try { board.setPointerCapture(e.pointerId); } catch (_) { /* fine without capture */ }
    setFocus(i, false);
    begin(i, e.button === 2 ? 'alt' : 'tap', e);
    if (e.pointerType === 'touch' && S.drag && S.drag.tap) {
      const p = { i, id: e.pointerId, timer: 0 };
      p.timer = setTimeout(() => {
        if (S.pending !== p || !S.drag) return;
        S.pending = null;
        S.drag.to = altOf(S.drag.snap[i]);
        S.drag.tap = false;
        paintCell(i);
        updateLines([i]);
        try { navigator.vibrate && navigator.vibrate(12); } catch (_) { /* no haptics */ }
      }, HOLD_MS);
      S.pending = p;
    }
  });
  board.addEventListener('pointermove', (e) => {
    if (clueHold && e.pointerId === clueHold.id) {
      if (Math.hypot(e.clientX - clueHold.x, e.clientY - clueHold.y) >= 10) cancelClueHold();
      return;
    }
    if (S.solved || !S.geo) return;
    if (S.drag && e.pointerId === S.drag.id) {
      for (const sample of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) paintTo(sample);
      if (S.pending && S.drag.moved) { clearTimeout(S.pending.timer); S.pending = null; }
      return;
    }
    if (e.pointerType === 'mouse') { const i = cellAt(e.clientX, e.clientY); showBands(i); }
  });
  function pointerEnd(e) {
    if (clueHold && e.pointerId === clueHold.id) cancelClueHold();
    if (S.pending && e.pointerId === S.pending.id) { clearTimeout(S.pending.timer); S.pending = null; }
    if (S.drag && e.pointerId === S.drag.id) {
      if (e.type === 'pointerup') paintTo(e);
      endGesture(e);
    }
  }
  board.addEventListener('pointerup', pointerEnd);
  board.addEventListener('pointercancel', pointerEnd);
  board.addEventListener('lostpointercapture', pointerEnd);
  board.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !S.drag) showBands(grid.contains(document.activeElement) ? S.focus : -1);
  });
  // Release still cancels a hold if pointer capture was unavailable.
  ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, cancelClueHold));
  window.addEventListener('blur', cancelClueHold);
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const clue = clueLine(e.target);
    if (clue && heldClue !== clue.head) { cancelClueHold(); toggleLock(clue.kind, clue.k); }
  });

  /* Any pointer press ends keyboard mode (hides the keyboard cursor). */
  document.addEventListener('pointerdown', () => { if (S.kbd) { S.kbd = false; placeCursor(); } }, true);

  // Background holds never enter the board gesture path. A second pointer,
  // movement, cancellation, or loss of the window cancels the pending hold.
  let backgroundHold = null, heldBackground = null;
  const emptyBackground = target => !target.closest('.cell, .clue, button, a, .hud, .caption, dialog');
  function cancelBackground() {
    if (backgroundHold) clearTimeout(backgroundHold.timer);
    backgroundHold = null;
  }
  document.addEventListener('pointerdown', e => {
    cancelBackground();
    heldBackground = null;
    if (!e.isPrimary || e.button !== 0 || modalOpen() || !emptyBackground(e.target) || S.drag || S.pending) return;
    const hold = { id: e.pointerId, x: e.clientX, y: e.clientY, opener: document.activeElement };
    hold.timer = setTimeout(() => {
      backgroundHold = null;
      heldBackground = hold;
      openSettings(hold.opener instanceof HTMLElement && hold.opener !== document.body ? hold.opener : settingsBtn);
    }, 500);
    backgroundHold = hold;
  });
  document.addEventListener('pointermove', e => {
    if (backgroundHold && e.pointerId === backgroundHold.id && Math.hypot(e.clientX - backgroundHold.x, e.clientY - backgroundHold.y) >= 10) cancelBackground();
  });
  ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, cancelBackground));
  window.addEventListener('blur', cancelBackground);
  document.addEventListener('contextmenu', e => {
    if (heldBackground && Math.hypot(e.clientX - heldBackground.x, e.clientY - heldBackground.y) < 10) e.preventDefault();
  });
  document.addEventListener('click', e => {
    if (heldBackground) { heldBackground = null; e.preventDefault(); e.stopImmediatePropagation(); return; }
    // Wait for release so a solved-screen background hold can open Settings.
    if (!S.solved || modalOpen() || e.target.closest('button, dialog') || performance.now() - S.solvedAt < 450) return;
    next();
  }, true);

  /* ---------- keyboard ---------- */
  grid.addEventListener('focusin', (e) => {
    const i = cellEls.indexOf(e.target);
    if (i >= 0) setFocus(i, false);
    showBands(S.focus); placeCursor();
  });
  grid.addEventListener('focusout', () => {
    setTimeout(() => { if (!grid.contains(document.activeElement)) { placeCursor(); showBands(-1); } }, 0);
  });
  grid.addEventListener('keydown', (e) => {
    if (S.solved) return;
    const { w, h } = S.puz;
    const i = S.focus;
    let r = Math.floor(i / w), c = i % w, moved = false, handled = true;
    switch (e.key) {
      case 'ArrowUp': r = Math.max(0, r - 1); moved = true; break;
      case 'ArrowDown': r = Math.min(h - 1, r + 1); moved = true; break;
      case 'ArrowLeft': c = Math.max(0, c - 1); moved = true; break;
      case 'ArrowRight': c = Math.min(w - 1, c + 1); moved = true; break;
      case 'Home': c = 0; if (e.ctrlKey) r = 0; moved = true; break;
      case 'End': c = w - 1; if (e.ctrlKey) r = h - 1; moved = true; break;
      case ' ': case 'Enter': act(i, S.cells[i] === INK ? BLANK : INK); break;
      case 'l': case 'L': if (!e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) toggleLock(e.shiftKey ? 'col' : 'row', e.shiftKey ? c : r); } else handled = false; break;
      case 'x': case 'X': act(i, S.cells[i] === MARK ? BLANK : MARK); break;
      case 'Delete': case 'Backspace': act(i, BLANK); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); S.kbd = true; }
    if (moved) {
      const j = r * w + c;
      setFocus(j, true);
      if (e.shiftKey && S.lastTo !== null && j !== i) act(j, S.lastTo);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (modalOpen()) return;
    const k = e.key;
    if (k === 'Tab') { S.kbd = true; setTimeout(placeCursor, 0); return; }
    if ((k === 'z' || k === 'Z') && !e.altKey) { e.preventDefault(); undo(); return; }
    if (k === '?') { e.preventDefault(); openHelp(); return; }
    if (S.solved && (k === 'Enter' || k === ' ') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); next(); return; }
    if (!S.solved && k.startsWith('Arrow') && !grid.contains(e.target) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      S.kbd = true;
      setFocus(S.focus, true);
    }
  });

  /* ---------- buttons ---------- */
  undoBtn.addEventListener('click', undo);
  modeBtn.addEventListener('click', () => {
    S.lastTap = null;
    S.mark = !S.mark;
    save.mark = S.mark;
    persist();
    hud();
    announce(S.mark ? 'Mark mode on: a tap marks a square empty' : 'Mark mode off: a tap fills');
  });
  nextBtn.addEventListener('click', next);
  // Share the unsolved quick-play board: same size and seed, so a friend
  // gets the identical puzzle (every generated board has one solution).
  shareBtn.addEventListener('click', async () => {
    const p = S.puz;
    if (!p.endless) return;
    const url = 'https://dr.eamer.dev/games/notan/?endless=' + p.size + '&seed=' + p.seed;
    const text = 'A ' + p.size + '\u00d7' + p.size + ' Notan board. Can you solve it?';
    if (navigator.share) {
      try { await navigator.share({ title: 'Notan', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      shareBtn.textContent = 'Link copied';
      announce('Link copied');
    } catch (_) {
      shareBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { shareBtn.textContent = 'Share blank'; }, 2500);
  });
  helpBtn.addEventListener('click', openHelp);
  lvlBtn.addEventListener('click', () => openLevels(false));

  /* ---------- sheets ---------- */
  function showSheet(dlg, opener) {
    if (dlg.open) return;
    dlg.showModal();
    dlg.scrollTop = 0;
    dlg.addEventListener('close', () => {
      // close() restores native focus synchronously, but this event is queued.
      // Keep any focus chosen since then (by the player or a new board/dialog).
      const active = document.activeElement;
      if (!dlg.open && (active === document.body || dlg.contains(active)) &&
          opener.isConnected && opener.getClientRects().length)
        opener.focus({ preventScroll: true });
    }, { once: true });
  }
  function openHelp() { showSheet(help, helpBtn); }
  function openSettings(opener = settingsBtn) {
    showSheet(settings, opener);
    $('#settings-sizes button[aria-pressed="true"]').focus({ preventScroll: true });
  }
  settingsBtn.addEventListener('click', () => openSettings());
  help.addEventListener('close', () => {
    if (!save.seen) { save.seen = true; persist(); }
  });
  dialogs.forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const controls = [...dlg.querySelectorAll('button, a[href]')];
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  $('#reset-level').addEventListener('click', () => { startOver(); settings.close(); });
  $('#reset-all').addEventListener('click', () => showSheet(resetConfirm, $('#reset-all')));
  $('#confirm-reset').addEventListener('click', () => {
    save.solved = {}; save.boards = {}; save.endless = null; save.at = null; save.plusUnlocked = false;
    persist();
    resetConfirm.close();
    settings.close();
    open(RAMP[0]);
    announce('All progress erased. Level 1.');
  });

  function appearance() {
    if (save.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = save.theme;
    document.documentElement.style.setProperty('--zoom', save.zoom / 100);
    const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[save.theme];
    const paths = {
      system: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>',
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
      dark: '<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
    };
    $('#theme-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[save.theme] + '</svg>';
    $('#theme-btn').setAttribute('aria-label', 'Theme: ' + save.theme + '. Switch to ' + nextTheme + '.');
    $('#zoom-sizes').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.textContent) === save.zoom)));
  }
  [100, 115, 130, 150].forEach(n => {
    const b = el('button', 'size-choice');
    b.type = 'button'; b.textContent = String(n);
    b.setAttribute('aria-label', n + ' percent');
    b.addEventListener('click', () => { save.zoom = n; appearance(); persist(); layout(); });
    $('#zoom-sizes').append(b);
  });
  $('#theme-btn').addEventListener('click', () => {
    save.theme = { system: 'light', light: 'dark', dark: 'system' }[save.theme];
    appearance(); persist();
  });
  appearance();

  function renderQuickChoices() {
    [sizesEl, $('#settings-sizes'), $('#solved-sizes')].filter(Boolean).forEach((row) => {
      row.replaceChildren();
      SIZES.forEach((n) => {
        const b = el('button', 'size-choice');
        b.type = 'button';
        b.textContent = String(n);
        b.setAttribute('aria-label', 'Quick play, ' + n + ' by ' + n);
        b.setAttribute('aria-pressed', String(save.quickSize === n));
        b.addEventListener('click', () => {
          const p = endless(n, newSeed());
          if (!p) { announce('Could not make a board. Please try again.'); return; }
          storeBoard();
          // Even a repeated seed starts with a blank board.
          save.endless = null;
          const dlg = row.closest('dialog');
          if (dlg) dlg.close();
          open(p);
          if (!dlg) setFocus(0, true);
          announce('Quick play, ' + n + ' by ' + n);
        });
        row.append(b);
      });
    });
  }
  function openLevels(atEnd) {
    lvGrid.textContent = '';
    plusGrid.textContent = '';
    plusSection.hidden = !save.plusUnlocked;
    let solved = 0;
    [...RAMP, ...(save.plusUnlocked ? PLUS : [])].forEach((p) => {
      const i = p.index;
      const li = el('li');
      const b = el('button', 'lv');
      b.type = 'button';
      const done = typeof save.solved[p.id] === 'number';
      b.textContent = String(i + 1);
      if (done) { solved++; b.classList.add('done'); }
      b.setAttribute('aria-label', label(p) + ', ' + (done ? p.name + ', solved' : p.w + ' by ' + p.h));
      if (S.puz.id === p.id) { b.setAttribute('aria-current', 'true'); }
      b.addEventListener('click', () => { levels.close(); open(p); setFocus(0, true); announce(label(p) + ', ' + p.w + ' by ' + p.h); });
      li.append(b);
      (p.plus ? plusGrid : lvGrid).append(li);
    });
    lvMeta.textContent = solved + ' of ' + (RAMP.length + (save.plusUnlocked ? PLUS.length : 0)) + ' solved';
    showSheet(levels, atEnd ? nextBtn : lvlBtn);
    (levels.querySelector('[aria-current="true"]') || lvGrid.querySelector('button'))?.focus({ preventScroll: true });

  }

  /* ---------- URL ---------- */
  function setUrl() {
    const p = S.puz;
    const q = p.endless ? '?endless=' + p.size + '&seed=' + p.seed : (p.plus ? '?plus=' : '?level=') + (p.index + 1);
    try { history.replaceState(null, '', location.pathname + q); } catch (_) { /* file:// or sandbox */ }
  }
  function initial() {
    const q = new URLSearchParams(location.search);
    if (q.has('plus') && save.plusUnlocked) {
      const n = Number(q.get('plus'));
      if (Number.isInteger(n) && n >= 1 && n <= PLUS.length) return PLUS[n - 1];
    }
    if (q.has('endless')) {
      const want = parseInt(q.get('endless'), 10);
      const size = SIZES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), 10);
      let seed = parseInt(q.get('seed'), 10);
      if (!(seed > 0)) seed = save.endless && save.endless.size === size ? save.endless.seed : newSeed();
      const p = endless(size, seed);
      if (p) return p;
    }
    if (q.has('level')) {
      const n = parseInt(q.get('level'), 10);
      if (n >= 1 && n <= RAMP.length) return RAMP[n - 1];
    }
    if (save.at === 'endless' && save.endless && SIZES.includes(save.endless.size) && save.endless.seed > 0) {
      const p = endless(save.endless.size, save.endless.seed);
      if (p) return p;
    }
    return [...RAMP, ...(save.plusUnlocked ? PLUS : [])].find((p) => p.id === save.at) || RAMP[0];
  }

  /* ---------- go ---------- */
  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layout); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) storeBoard(); });
  window.addEventListener('pagehide', storeBoard);

  open(initial());
  // How to play opens only from the ? button or the ? key, never on load (Luke, 2026-10-04).
  window.__notan = { S, RAMP, PLUS, open, next, endless, isSolved };
})();
