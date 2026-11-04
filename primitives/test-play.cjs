const { chromium } = require('playwright');
const OUT = process.argv[2] || require('os').tmpdir();

// Halfway through a zoom, every square on the departing board must still sit
// in its own row and column, with none missing. Returns null when no board is
// leaving (no solve, or a zoom into a Patch tile).
function midZoom() {
  const all = document.querySelectorAll('.pz.leaving');
  const el = all[all.length - 1];
  if (!el) return null;
  const [w, , h] = el.getAttribute('aria-label').split(' ').map(Number);
  const cell = parseFloat(el.style.getPropertyValue('--cell'));
  const cw = parseFloat(el.style.getPropertyValue('--cw'));
  const ch = parseFloat(el.style.getPropertyValue('--ch'));
  const cells = [...el.querySelectorAll('.cell')];
  const misplaced = cells.filter((c) => {
    const i = +c.dataset.i;
    return Math.abs(c.offsetLeft - (cw + (i % w) * cell)) > 1 || Math.abs(c.offsetTop - (ch + Math.floor(i / w) * cell)) > 1;
  }).length;
  return { w, h, missing: w * h - cells.length, misplaced };
}

(async () => {
  // CHROMIUM_PATH points at a browser already on disk when Playwright's own build is missing.
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  // The page's calm timings (pause 1800, move 2200, fade 400 ms) are checked
  // once below; every other page runs shorter ones so the waits stay short.
  const FAST = () => { window.__zoomTiming = { pause: 600, zoom: 1300, fade: 300 }; };
  const rawNewPage = b.newPage.bind(b), rawNewContext = b.newContext.bind(b);
  b.newPage = async (o) => { const p = await rawNewPage(o); await p.addInitScript(FAST); return p; };
  b.newContext = async (o) => { const c = await rawNewContext(o); await c.addInitScript(FAST); return c; };
  const errs = [];
  let zooms = 0;
  for (const [vw, vh, tag] of [[1200, 860, 'desk'], [390, 800, 'phone']]) {
    const pg = await b.newPage({ viewport: { width: vw, height: vh } });
    await pg.route('https://stats.dr.eamer.dev/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    pg.on('pageerror', (e) => errs.push(tag + ' ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(tag + ' ' + m.text()); });
    await pg.goto((process.env.BASE || 'http://127.0.0.1:8765') + '/notan-zoom-lab/');
    await pg.evaluate(() => localStorage.clear());
    await pg.reload();
    for (const mode of ['merge', 'pixel', 'hole', 'ring', 'patch', 'mines']) {
      // a tab does nothing while a zoom is still running
      await pg.waitForFunction(() => !ZoomLab.busy(), null, { timeout: 15000 });
      await pg.click(`.tab[data-mode="${mode}"]`);
      const levels = mode === 'ring' ? 6 : mode === 'hole' ? 5 : mode === 'patch' ? 2 : 3;
      for (let L = 0; L < levels; L++) {
        // solve whatever is on screen by clicking cells
        for (let guard = 0; guard < 12; guard++) {
          await pg.waitForTimeout(2400);
          const isWorld = await pg.$('.world');
          if (isWorld) {
            const open = await pg.$('.tile:not(:disabled)');
            if (!open) break;
            await open.click();
            await pg.waitForTimeout(2000);
          }
          const todo = await pg.evaluate(() => {
            const S = ZoomLab.state(), ch = S.chains[S.mode];
            const p = ch.cur.kind === 'world' ? ch.cur.tiles[ch.view].puzzle : ch.cur;
            const out = [];
            for (let i = 0; i < p.sol.length; i++) if (p.given[i] < 0 && p.sol[i] && p.cells[i] !== 1) out.push(i);
            return out;
          });
          if (L === levels - 1 && guard === 0) await pg.screenshot({ path: `${OUT}/${mode}-${tag}-start.png` });
          for (const i of todo) await pg.click(`.cell[data-i="${i}"]`);
          // A solve waits 700 ms, then the camera moves for 1400 ms: look while it moves.
          await pg.waitForTimeout(1100);
          const mid = await pg.evaluate(midZoom);
          if (mid) {
            zooms++;
            if (mid.missing || mid.misplaced) errs.push(`${tag} ${mode} mid-zoom ${mid.w}x${mid.h}: ${mid.missing} missing, ${mid.misplaced} misplaced`);
          } else if (todo.length) {
            // Filling every ink square solves the board, so a board should be leaving.
            errs.push(`${tag} ${mode}: no departing board 1100 ms after a solve, zoom not checked`);
          }
          const s = await pg.evaluate(() => { const S = ZoomLab.state(); return S.chains[S.mode].cur.kind; });
          if (s !== 'world') break;
          const left = await pg.evaluate(() => { const S = ZoomLab.state(); const w = S.chains[S.mode].cur; return w.kind === 'world' ? w.tiles.filter(t => !t.done).length : -1; });
          if (left === 0) break;
        }
      }
      await pg.waitForTimeout(3200);
      await pg.screenshot({ path: `${OUT}/${mode}-${tag}-end.png` });
      const info = await pg.evaluate(() => { const S = ZoomLab.state(); const ch = S.chains[S.mode]; return { depth: ch.depth, kind: ch.cur.kind || 'board', w: ch.cur.w }; });
      console.log(tag, mode, JSON.stringify(info));
    }
    // New game asks before it throws away a chain that has come this far.
    await askChecks(pg, tag, errs);
    await pg.close();
  }
  for (const [vw, vh] of [[390, 800], [320, 640]]) await minesChecks(b, vw, vh, errs);
  await fitChecks(b, errs);
  await flowChecks(b, errs);
  await forcedChecks(b, errs);
  await rulesChecks(b, errs);
  console.log('mid-zoom checks:', zooms);
  {
    const rawCtx = await rawNewContext({ viewport: { width: 390, height: 844 } });
    const raw = await rawCtx.newPage();
    await raw.goto((process.env.BASE || 'http://127.0.0.1:8765') + '/notan-zoom-lab/');
    const t = await raw.evaluate(() => ZoomLab.timing());
    if (!(t.pause >= 1500 && t.zoom >= 2000 && t.fade >= 300)) errs.push('calm timing defaults changed: ' + JSON.stringify(t));
    await rawCtx.close();
  }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
  process.exitCode = errs.length || !zooms ? 1 : 0;
})();

const BASE = () => (process.env.BASE || 'http://127.0.0.1:8765') + '/notan-zoom-lab/';
/* Click something a regression could remove, and say so instead of crashing. */
async function tryClick(pg, sel, fail) {
  try { await pg.click(sel, { timeout: 3000 }); } catch (e) { fail(`could not press ${sel}`); }
}
const live = (pg) => pg.evaluate(() => document.getElementById('live').textContent);
const seedOf = (pg, m) => pg.evaluate((m) => ZoomLab.state().chains[m].seed, m);

/* New game: no question with nothing to lose; with progress it asks in the
 * bar, focuses Keep playing, ignores a second tap and the board's keys, and
 * Escape, a tab or a touch on the board keeps the game. */
async function askChecks(pg, tag, errs) {
  const fail = (m) => errs.push(`${tag} new game: ${m}`);
  await pg.waitForFunction(() => !ZoomLab.busy(), null, { timeout: 15000 });
  await pg.click('.tab[data-mode="merge"]');
  await pg.evaluate(() => { const ch = ZoomLab.state().chains.merge; while (ch.depth < 3) ZoomLab.advance('merge', ch); ZoomLab.render(); });
  await pg.waitForTimeout(400);
  // this chain has come several zooms: the question names how far
  let seed = await seedOf(pg, 'merge');
  await askClear(pg, fail, 'merge');
  const t = await pg.evaluate(() => ({ ask: !document.getElementById('ask').hidden, main: document.getElementById('bar-main').hidden, focus: document.activeElement.id, text: document.getElementById('ask-text').textContent }));
  if (!t.ask || !t.main || t.focus !== 'ask-no' || !/^Start a new Merge game\? This one ends at zoom \d+\.$/.test(t.text)) fail(`did not ask after progress ${JSON.stringify(t)}`);
  const undoLen = await pg.evaluate(() => ZoomLab.state().chains.merge.undo.length);
  await pg.keyboard.press('z');
  if (await pg.evaluate(() => ZoomLab.state().chains.merge.undo.length) !== undoLen) fail('Z acted while asking');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const k = await pg.evaluate(() => ({ ask: !document.getElementById('ask').hidden, focus: document.activeElement.id }));
  if (k.ask || k.focus !== 'new-btn' || (await seedOf(pg, 'merge')) !== seed || !/^Kept your Merge game\.$/.test(await live(pg))) fail(`Escape did not keep the game ${JSON.stringify(k)}`);
  // a quick second tap does nothing; a deliberate one starts over
  await pg.click('#new-btn');
  await tryClick(pg, '#ask-yes', fail);
  if ((await seedOf(pg, 'merge')) !== seed) fail('a double tap started a new game');
  await pg.waitForTimeout(650);
  await tryClick(pg, '#ask-yes', fail);
  await pg.waitForTimeout(150);
  const y = await pg.evaluate(() => ({ ask: !document.getElementById('ask').hidden, focus: document.activeElement.id, depth: ZoomLab.state().chains.merge.depth }));
  if ((await seedOf(pg, 'merge')) === seed || y.ask || y.focus !== 'new-btn' || y.depth !== 1 || !/^New Merge game\.$/.test(await live(pg))) fail(`New game did not start over ${JSON.stringify(y)}`);
  // a fresh board with nothing on it: no question
  seed = await seedOf(pg, 'merge');
  await pg.click('#new-btn');
  if (await pg.evaluate(() => !document.getElementById('ask').hidden) || (await seedOf(pg, 'merge')) === seed) fail('asked with nothing to lose');
  // marks on a first board: asks, and a tab or a touch on the board keeps it
  await pg.waitForTimeout(1600);
  await pg.click('.pz .cell:not(.given)');
  await pg.click('#new-btn');
  const m = await pg.evaluate(() => document.getElementById('ask-text').textContent);
  if (m !== 'Start a new Merge game? Your marks on this board will be cleared.') fail(`ask text "${m}"`);
  seed = await seedOf(pg, 'merge');
  await pg.click('.tab[data-mode="pixel"]');
  if (await pg.evaluate(() => !document.getElementById('ask').hidden || ZoomLab.state().mode !== 'pixel')) fail('a tab did not close the question');
  await pg.click('.tab[data-mode="merge"]');
  await pg.click('#new-btn');
  await pg.dispatchEvent('.pz .pz-bg', 'pointerdown');
  if (await pg.evaluate(() => !document.getElementById('ask').hidden) || (await seedOf(pg, 'merge')) !== seed) fail('a touch on the board did not keep the game');
  // Patch with All tiles showing: the bar has six controls, and the confirm
  // still keeps clear of the New game button
  await pg.click('.tab[data-mode="patch"]');
  await pg.evaluate(() => { const ch = ZoomLab.state().chains.patch; if (ch.cur.kind !== 'world') ZoomLab.advance('patch', ch); ch.view = ch.cur.tiles.findIndex((t) => !t.center && !t.done); ZoomLab.render(); });
  await askClear(pg, fail, 'patch');
  await pg.keyboard.press('Escape');
}

/* Open the question with a click on New game, and check that neither the
 * confirm covers the spot that was clicked nor a click there 400 ms later
 * starts over. */
async function askClear(pg, fail, mode) {
  const nb = await pg.locator('#new-btn').boundingBox();
  const seed = await seedOf(pg, mode);
  await pg.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  const yes = await pg.locator('#ask-yes').boundingBox();
  if (!yes || !(yes.x >= nb.x + nb.width || yes.x + yes.width <= nb.x)) fail(`${mode}: the confirm (${yes && Math.round(yes.x)}-${yes && Math.round(yes.x + yes.width)}) covers New game (${Math.round(nb.x)}-${Math.round(nb.x + nb.width)})`);
  const look = await pg.evaluate(() => {
    const y = getComputedStyle(document.getElementById('ask-yes')), n = getComputedStyle(document.getElementById('ask-no'));
    return { yesBg: y.backgroundColor, noRing: n.boxShadow };
  });
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(look.yesBg) || look.noRing === 'none') fail(`${mode}: the confirm looks primary ${JSON.stringify(look)}`);
}

/* Mines, on a known picture so the script can aim: a wrong fill is a mine
 * that stays, a drag keeps to its row and stops at its first mine, letting
 * go off the board cancels, a hold marks, three mines lose the board, and
 * Another board deals a new picture at the same zoom. */
async function minesChecks(b, vw, vh, errs) {
  const tag = `mines ${vw}`;
  const fail = (m) => errs.push(`${tag}: ${m}`);
  const pg = await b.newPage({ viewport: { width: vw, height: vh } });
  pg.on('pageerror', (e) => errs.push(tag + ' ' + e.message));
  await pg.goto(BASE() + '?mode=mines');
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  await pg.waitForTimeout(1600);
  // the picture: row 0 is ink ink empty ink empty, and so on
  const ART = ['##.#.', '.###.', '#...#', '###..', '..###'];
  await pg.evaluate((art) => {
    const p = ZoomLab.state().chains.mines.cur;
    art.join('').split('').forEach((ch, i) => { p.sol[i] = ch === '#' ? 1 : 0; });
    ZoomLab.render();
  }, ART);
  const st = () => pg.evaluate(() => { const p = ZoomLab.state().chains.mines.cur; return { cells: Array.from(p.cells), hit: Array.from(p.hit), hits: p.hits, lost: p.lost, readout: document.getElementById('readout').textContent }; });
  const center = async (i) => { const r = await pg.locator(`.pz .cell[data-i="${i}"]`).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2, r.width]; };
  // 1. a wrong fill
  await pg.click('.pz .cell[data-i="5"]');
  await pg.waitForTimeout(120);
  let s = await st();
  const c5 = await pg.evaluate(() => { const x = document.querySelector('.pz .cell[data-i="5"]'); return { hit: x.classList.contains('hit'), ink: x.classList.contains('ink'), x: !!x.querySelector('.x'), boom: document.querySelectorAll('.pz .boom .flash').length }; });
  if (c5.boom !== 1) fail(`a mine should go off with one flash, got ${c5.boom}`);
  await pg.waitForTimeout(1500);
  if (await pg.evaluate(() => document.querySelectorAll('.pz .boom').length)) fail('the detonation did not clear away');
  if (!c5.hit || c5.ink || !c5.x || !s.readout.includes('mines hit 1 of 3') || !(await live(pg)).startsWith('Mine at row')) fail(`a wrong fill did not hit a mine ${JSON.stringify(c5)} ${s.readout}`);
  // 2. Undo never takes back a mine: with only the mine down there is
  // nothing to undo, and the button says so where it can be seen;
  // 3. Clear board keeps the mine
  await pg.click('#undo-btn', { force: true }); // aria-disabled stays pressable
  await pg.waitForTimeout(120);
  s = await st();
  const shown = await pg.evaluate(() => document.getElementById('keys-text').textContent);
  if (!s.hit[5] || shown !== 'Nothing to undo.') fail(`Undo took back a mine, or said nothing on screen ("${shown}")`);
  await pg.click('#reset-btn', { force: true }); // aria-disabled stays pressable
  s = await st();
  if (!s.hit[5] || !s.readout.includes('1 of 3')) fail('Clear board took back a mine');
  // 4. a drag along row 0: ink, ink, then the mine at column 2 stops it
  let [x0, y0, cw] = await center(0);
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  for (let c = 1; c <= 3; c++) await pg.mouse.move(x0 + c * cw, y0, { steps: 3 });
  const mid = await st();
  const pend = await pg.evaluate(() => document.querySelectorAll('.pz .cell.pend').length);
  if (mid.cells.slice(0, 4).some((v) => v !== -1) || pend !== 4) fail(`the drag changed squares before release, or showed ${pend} pending`);
  await pg.mouse.up();
  s = await st();
  if (s.cells[0] !== 1 || s.cells[1] !== 1 || !s.hit[2] || s.cells[3] !== -1 || s.hits !== 2 || !s.readout.includes('2 of 3')) fail(`the drag did not stop at its mine ${JSON.stringify(s.cells.slice(0, 5))} hits ${s.hits}`);
  // one Undo takes back both fills, and the mine stays
  await pg.keyboard.press('z');
  await pg.waitForTimeout(120);
  s = await st();
  if (s.cells[0] !== -1 || s.cells[1] !== -1 || !s.hit[2] || s.hits !== 2 || !(await live(pg)).startsWith('Undid 2 squares')) fail(`one Undo after a mine ${JSON.stringify(s.cells.slice(0, 5))} "${await live(pg)}"`);
  // a tap that wobbles 3 px over the edge of its square fills only that square
  const touch = (type, i, x, y, id) => pg.evaluate(([type, i, x, y, id]) => {
    document.querySelector(`.pz .cell[data-i="${i}"]`).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, isPrimary: id === 9 }));
  }, [type, i, x, y, id]);
  {
    const r = await pg.locator('.pz .cell[data-i="8"]').boundingBox();
    const x = r.x + r.width - 1, y = r.y + r.height / 2;
    await touch('pointerdown', 8, x, y, 9);
    await touch('pointermove', 8, x + 3, y, 9);
    await touch('pointerup', 8, x + 3, y, 9);
    s = await st();
    if (s.cells[8] !== 1 || s.cells[9] !== -1 || s.hits !== 2) fail(`a wobbling tap reached the next square (${s.cells[8]}, ${s.cells[9]}, hits ${s.hits})`);
  }
  // a second finger never moves or commits the first finger's pick
  {
    const [x1, y1] = await center(13), [x2, y2] = await center(3);
    await touch('pointerdown', 13, x1, y1, 9);
    await touch('pointerdown', 3, x2, y2, 10);
    await touch('pointermove', 3, x2 - 40, y2, 10);
    await touch('pointerup', 3, x2 - 40, y2, 10);
    s = await st();
    const pend = await pg.evaluate(() => document.querySelectorAll('.pz .cell.pend').length);
    await touch('pointercancel', 13, x1, y1, 9);
    const after = await st();
    if (s.hits !== 2 || s.cells[13] !== -1 || s.cells[3] !== -1 || pend !== 1 || after.hits !== 2 || after.cells[13] !== -1) fail(`a second finger moved or committed a pick (hits ${s.hits}, pending ${pend})`);
  }
  // 5. the drag keeps to its row: right three, then half a square down
  [x0, y0, cw] = await center(15);
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  await pg.mouse.move(x0 + 2 * cw, y0, { steps: 4 });
  await pg.mouse.move(x0 + 2 * cw, y0 + cw * 0.6, { steps: 2 });
  await pg.mouse.up();
  s = await st();
  if (s.cells.slice(15, 18).join() !== '1,1,1' || s.cells.slice(20).some((v) => v !== -1)) fail(`the drag left its row ${s.cells.join()}`);
  // 6. letting go well off the board cancels
  [x0, y0, cw] = await center(22);
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  await pg.mouse.move(x0 + 5 * cw, y0, { steps: 4 });
  await pg.mouse.up();
  s = await st();
  if (s.cells.slice(20).some((v) => v !== -1)) fail('letting go off the board did not cancel');
  // 7. a touch hold marks, and never costs a mine
  [x0, y0] = await center(24);
  await pg.evaluate(([x, y]) => {
    const el = document.querySelector('.pz .cell[data-i="24"]');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: x, clientY: y, isPrimary: true }));
  }, [x0, y0]);
  await pg.waitForTimeout(520);
  await pg.evaluate(([x, y]) => {
    const el = document.querySelector('.pz .cell[data-i="24"]');
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 9, clientX: x, clientY: y, isPrimary: true }));
  }, [x0, y0]);
  s = await st();
  if (s.cells[24] !== 0 || s.hits !== 2) fail(`a hold did not mark (${s.cells[24]}, hits ${s.hits})`);
  // in Marking mode a hold stays a mark: it never turns into a fill
  await pg.click('#tool-btn');
  {
    const [x, y] = await center(19);
    await touch('pointerdown', 19, x, y, 9);
    await pg.waitForTimeout(650);
    await touch('pointerup', 19, x, y, 9);
    s = await st();
    if (s.cells[19] !== 0 || s.hits !== 2) fail(`a hold in Marking mode filled (${s.cells[19]}, hits ${s.hits})`);
  }
  await pg.click('#tool-btn');
  // a fill on a marked square clears the mark, and a drag that fills a line skips marks
  await pg.click('.pz .cell[data-i="19"]');
  s = await st();
  if (s.cells[19] !== -1 || s.hits !== 2) fail(`a fill on a mark did not just clear it (${s.cells[19]}, hits ${s.hits})`);
  await pg.click('.pz .cell[data-i="19"]', { button: 'right' });
  {
    const [x, y, cw] = await center(14);
    await pg.mouse.move(x, y);
    await pg.mouse.down();
    await pg.mouse.move(x, y + 2 * cw, { steps: 4 });
    await pg.mouse.up();
    s = await st();
    if (s.cells[14] !== 1 || s.cells[19] !== 0 || s.cells[24] !== 0 || s.hits !== 2) fail(`a fill drag went through marks (${s.cells[14]}, ${s.cells[19]}, ${s.cells[24]}, hits ${s.hits})`);
  }
  // 11. both themes: a found mine is a dashed square with a cross; a mark has no cross
  for (const theme of ['light', 'dark']) {
    await pg.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
    const look = await pg.evaluate(() => {
      const h = document.querySelector('.pz .cell.hit'), m = document.querySelector('.pz .cell.mark');
      const x = h.querySelector('.x').getBoundingClientRect();
      const gray = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number); return v[0] === v[1] && v[1] === v[2]; };
      const cols = [getComputedStyle(h, '::before').backgroundColor, getComputedStyle(h, '::before').outlineColor, getComputedStyle(h.querySelector('.x')).color, getComputedStyle(document.body).backgroundColor];
      return { dashed: getComputedStyle(h, '::before').outlineStyle, x: x.width > 0 && x.height > 0, markX: !!(m && m.querySelector('.x')), gray: cols.every(gray) };
    });
    if (look.dashed !== 'dashed' || !look.x || look.markX || !look.gray) fail(`${theme}: ${JSON.stringify(look)}`);
  }
  // 8. the third mine loses the board, and 9. Another board waits 600 ms
  await pg.click('.pz .cell[data-i="11"]');
  await tryClick(pg, '#another-btn', fail);
  s = await st();
  if (!s.lost) fail('the third mine did not lose the board, or Another board skipped the reveal');
  const lostLook = await pg.evaluate(() => {
    const p = ZoomLab.state().chains.mines.cur;
    let missing = 0;
    for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.given[i] < 0 && p.cells[i] !== 1) missing++;
    return { lost: !!document.querySelector('.pz.lost'), answers: document.querySelectorAll('.pz .cell.answer').length, missing, cap: !!document.querySelector('.lost-cap') && !document.querySelector('.lost-cap p'), btn: !!document.getElementById('another-btn') && document.getElementById('another-btn').offsetHeight > 0, undo: document.getElementById('undo-btn').getAttribute('aria-disabled'), clear: document.getElementById('reset-btn').getAttribute('aria-disabled'), readout: document.getElementById('readout').textContent };
  });
  if (!lostLook.lost || lostLook.answers !== lostLook.missing || !lostLook.cap || !lostLook.btn || lostLook.undo !== 'true' || lostLook.clear !== 'true' || !lostLook.readout.endsWith('board lost')) fail(`lost board ${JSON.stringify(lostLook)}`);
  const before = await st();
  await pg.click('.pz .cell[data-i="23"]');
  await pg.keyboard.press('z');
  await pg.click('#reset-btn', { force: true }); // aria-disabled stays pressable
  s = await st();
  if (s.cells.join() !== before.cells.join() || s.hits !== 3) fail('a lost board took a pick, an undo or a clear');
  const clues = await pg.evaluate(() => [...document.querySelectorAll('.pz .clue')].map((c) => c.textContent).join('|'));
  const given = await pg.evaluate(() => Array.from(ZoomLab.state().chains.mines.cur.given).join());
  await pg.waitForTimeout(650);
  await tryClick(pg, '#another-btn', fail);
  await pg.waitForTimeout(300);
  const fresh = await pg.evaluate(() => { const ch = ZoomLab.state().chains.mines; return { depth: ch.depth, w: ch.cur.w, hits: ch.cur.hits, lost: ch.cur.lost, given: Array.from(ch.cur.given).join(), clues: [...document.querySelectorAll('.pz .clue')].map((c) => c.textContent).join('|'), readout: document.getElementById('readout').textContent }; });
  if (fresh.depth !== 1 || fresh.w !== 5 || fresh.hits !== 0 || fresh.lost || fresh.given !== given || fresh.clues === clues || !fresh.readout.includes('0 of 3')) fail(`Another board ${JSON.stringify(fresh)}`);
  // 10. a found mine survives a reload
  const empty = await pg.evaluate(() => { const p = ZoomLab.state().chains.mines.cur; return p.sol.findIndex((v, i) => !v && p.given[i] < 0); });
  await pg.waitForTimeout(1500);
  await pg.click(`.pz .cell[data-i="${empty}"]`);
  await pg.reload();
  await pg.waitForTimeout(400);
  const kept = await pg.evaluate((i) => ({ hit: document.querySelector(`.pz .cell[data-i="${i}"]`).classList.contains('hit'), readout: document.getElementById('readout').textContent }), empty);
  if (!kept.hit || !kept.readout.includes('1 of 3')) fail(`a found mine did not survive a reload ${JSON.stringify(kept)}`);
  // 13. 8x8 cells stay at least 28px on a 320 screen
  if (vw === 320) {
    const cell = await pg.evaluate(() => {
      const ch = ZoomLab.state().chains.mines;
      while (ch.cur.w < 8) ZoomLab.advance('mines', ch);
      ZoomLab.render();
      return document.querySelector('.pz .cell').getBoundingClientRect().width;
    });
    if (cell < 28) fail(`8x8 cells are ${cell.toFixed(1)}px at 320`);
  }
  await pg.close();
}

/* Six tabs and the labeled bar fit on small phones: one row of tabs, no
 * sideways scroll, every control at least 44 by 44 with its label whole,
 * including the six controls of a Patch tile. */
async function fitChecks(b, errs) {
  for (const [vw, vh] of [[320, 640], [375, 667], [390, 844], [1200, 860]]) {
    const pg = await b.newPage({ viewport: { width: vw, height: vh } });
    pg.on('pageerror', (e) => errs.push(`fit ${vw} ${e.message}`));
    await pg.goto(BASE() + '?mode=patch');
    await pg.evaluate(() => localStorage.clear());
    await pg.reload();
    await pg.evaluate(() => { const ch = ZoomLab.state().chains.patch; ZoomLab.advance('patch', ch); ch.view = 0; ZoomLab.render(); });
    const f = await pg.evaluate(() => {
      const vw = innerWidth, tabs = [...document.querySelectorAll('.tab')].map((t) => ({ r: t.getBoundingClientRect(), fits: t.scrollWidth <= t.clientWidth }));
      const tbs = [...document.querySelectorAll('.bar .tb')].filter((t) => t.offsetParent).map((t) => ({ r: t.getBoundingClientRect(), l: t.querySelector('.tb-label'), title: t.title }));
      const overlap = tbs.some((a, i) => tbs.some((z, j) => i < j && a.r.left < z.r.right - 0.5 && z.r.left < a.r.right - 0.5 && a.r.top < z.r.bottom - 0.5 && z.r.top < a.r.bottom - 0.5));
      return {
        page: document.documentElement.scrollWidth <= vw,
        tabsRow: new Set(tabs.map((t) => Math.round(t.r.top))).size === 1 && document.querySelector('.tabs').scrollWidth <= document.querySelector('.tabs').clientWidth,
        tabsIn: tabs.every((t) => t.r.left >= 16 && t.r.right <= vw - 16 && t.r.width >= 24 && t.r.height >= 40 && t.fits),
        controls: tbs.length,
        big: tbs.every((t) => t.r.width >= 44 && t.r.height >= 44),
        // icons only: each label is hidden on screen but kept as the name, with a tooltip
        labels: tbs.every((t) => t.l && t.l.textContent.trim() && t.l.getBoundingClientRect().width <= 1 && t.title),
        overlap,
      };
    });
    if (!f.page || !f.tabsRow || !f.tabsIn || f.controls !== 6 || !f.big || !f.labels || f.overlap) errs.push(`fit ${vw}: ${JSON.stringify(f)}`);
    await pg.close();
  }
}

/* Focus, tabs and drags: keyboard focus survives a zoom and lands on the
 * new board (or the Patch plate's first open tile, announced); a tab
 * pressed mid-zoom opens when the zoom ends; arrows and X on a tab move
 * along the tabs and never touch the board; a fast drag paints every
 * square it passes; and on a short landscape phone the board clears the bar. */
async function flowChecks(b, errs) {
  const fail = (m) => errs.push(`flow: ${m}`);
  const pg = await b.newPage({ viewport: { width: 1200, height: 860 } });
  pg.on('pageerror', (e) => errs.push('flow ' + e.message));
  await pg.goto(BASE() + '?mode=merge');
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  await pg.waitForTimeout(1600);
  // fill all but one ink square, then finish from the keyboard
  const keySolve = async (mode) => {
    const at = await pg.evaluate((mode) => {
      const ch = ZoomLab.state().chains[mode], p = ch.cur.kind === 'world' ? ch.cur.tiles[ch.view].puzzle : ch.cur;
      const ink = [];
      for (let i = 0; i < p.sol.length; i++) if (p.sol[i] && p.given[i] < 0) ink.push(i);
      const lastInk = ink.pop();
      for (const i of ink) p.cells[i] = 1;
      ZoomLab.render();
      return { r: Math.floor(lastInk / p.w), c: lastInk % p.w };
    }, mode);
    await pg.focus('.pz');
    await pg.keyboard.press('ArrowRight'); // the cursor appears at the top left
    for (let k = 0; k < at.r; k++) await pg.keyboard.press('ArrowDown');
    for (let k = 0; k < at.c; k++) await pg.keyboard.press('ArrowRight');
    await pg.keyboard.press(' ');
  };
  await keySolve('merge');
  // a tab pressed mid-zoom waits for the zoom, then opens
  await pg.waitForTimeout(900);
  await pg.click('.tab[data-mode="ring"]');
  const mid = await pg.evaluate(() => ({ mode: ZoomLab.state().mode, busy: ZoomLab.busy() }));
  await pg.waitForFunction(() => !ZoomLab.busy(), null, { timeout: 8000 });
  await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => ({ mode: ZoomLab.state().mode, depth: ZoomLab.state().chains.merge.depth }));
  if (mid.mode !== 'merge' || !mid.busy || after.mode !== 'ring' || after.depth !== 2) fail(`a tab during a zoom ${JSON.stringify({ mid, after })}`);
  // focus survives a zoom
  await pg.click('.tab[data-mode="merge"]');
  await pg.waitForTimeout(300);
  await keySolve('merge');
  await pg.waitForTimeout(600 + 1300 + 300 + 500);
  const f = await pg.evaluate(() => { const a = document.activeElement; return { pz: a.classList.contains('pz') && !a.classList.contains('leaving'), tag: a.tagName }; });
  if (!f.pz) fail(`focus after a zoom is on ${f.tag}`);
  // Patch: the starter solved from the keyboard lands focus on a tile, and the plate is announced
  await pg.click('.tab[data-mode="patch"]');
  await pg.waitForTimeout(400);
  await keySolve('patch');
  await pg.waitForTimeout(600 + 1300 + 300 + 1200);
  const pf = await pg.evaluate(() => ({ tile: document.activeElement.classList.contains('tile'), live: document.getElementById('live').textContent }));
  if (!pf.tile || !/Pick a tile/.test(pf.live)) fail(`the plate took no focus or was not announced ${JSON.stringify(pf)}`);
  // arrows and X on a tab move along the tabs and leave the board alone
  await pg.click('.tab[data-mode="pixel"]');
  await pg.waitForTimeout(300);
  const marks0 = await pg.evaluate(() => Array.from(ZoomLab.state().chains.pixel.cur.cells).join());
  await pg.focus('.tab[data-mode="pixel"]');
  await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('x');
  const k = await pg.evaluate(() => ({ focus: document.activeElement.dataset.mode, cursor: !!document.querySelector('.pz .cursor.on'), cells: Array.from(ZoomLab.state().chains.pixel.cur.cells).join() }));
  if (k.focus !== 'hole' || k.cursor || k.cells !== marks0) fail(`keys on a tab reached the board ${JSON.stringify(k)}`);
  // a fast drag along a row paints every square it passes
  await pg.click('.tab[data-mode="pixel"]');
  await pg.waitForTimeout(300);
  const row = await pg.evaluate(() => { const p = ZoomLab.state().chains.pixel.cur; p.cells.fill(-1); ZoomLab.render(); return p.w; });
  const a = await pg.locator('.pz .cell[data-i="0"]').boundingBox(), z = await pg.locator(`.pz .cell[data-i="${row - 1}"]`).boundingBox();
  await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 1 });
  await pg.mouse.up();
  const painted = await pg.evaluate((w) => Array.from(ZoomLab.state().chains.pixel.cur.cells).slice(0, w), row);
  if (painted.some((v) => v !== 1)) fail(`a fast drag skipped squares ${painted.join()}`);
  await pg.close();
  // a short landscape phone: the board's last row clears the bar
  for (const mode of ['mines', 'merge', 'hole']) {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const q = await ctx.newPage();
    await q.goto(BASE() + '?mode=' + mode);
    await q.waitForTimeout(1600);
    const fit = await q.evaluate(() => ({ pz: document.querySelector('.pz').getBoundingClientRect().bottom, bar: document.getElementById('bar').getBoundingClientRect().top }));
    if (fit.pz > fit.bar) fail(`844x390 ${mode}: the board runs ${Math.round(fit.pz - fit.bar)} px under the bar`);
    await ctx.close();
  }
}

/* Forced colors (Windows High Contrast): the board must still show open
 * squares, your ink, marks, locked squares and a found mine. */
async function rulesChecks(b, errs) {
  const fail = (m) => errs.push(`rules: ${m}`);
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  pg.on('pageerror', (e) => errs.push('rules ' + e.message));
  await pg.goto(BASE() + '?mode=merge');
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  await pg.waitForTimeout(300);
  if (await pg.locator('#rules-btn').isVisible()) fail('the rules heart shows outside Mines');
  await pg.goto(BASE() + '?mode=mines');
  await pg.waitForTimeout(300);
  const look = () => pg.evaluate(() => { const r = document.getElementById('rules-btn'), p = ZoomLab.state().chains.mines.cur; return { rule: r.dataset.rule, name: r.querySelector('.tb-label').textContent, title: r.title, svg: !!r.querySelector('svg'), limit: p.limit, saved: ZoomLab.state().minesRule }; });
  let l = await look();
  if (l.rule !== 'careful' || l.limit !== 3 || !l.svg || !/Careful/.test(l.name) || !l.title) fail(`default should be Careful, 3 ${JSON.stringify(l)}`);
  const want = [['perfect', 1], ['relaxed', 5], ['careful', 3]];
  for (const [rule, n] of want) {
    await pg.click('#rules-btn');
    l = await look();
    if (l.rule !== rule || l.limit !== n || l.saved !== rule) fail(`press should give ${rule} ${n}: ${JSON.stringify(l)}`);
  }
  // a stricter rule never loses the board in play on the spot
  await pg.evaluate(() => { const p = ZoomLab.state().chains.mines.cur; p.hits = 2; ZoomLab.render(); });
  await pg.click('#rules-btn');
  l = await look();
  if (l.rule !== 'perfect' || l.limit !== 3) fail(`Perfect with 2 mines hit should wait for the next board ${JSON.stringify(l)}`);
  await pg.close();
  // reduced motion: no detonation, only the scorched square
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const q = await ctx.newPage();
  await q.goto(BASE() + '?mode=mines');
  await q.evaluate(() => localStorage.clear());
  await q.reload();
  await q.waitForTimeout(300);
  const i = await q.evaluate(() => { const p = ZoomLab.state().chains.mines.cur; for (let k = 0; k < p.sol.length; k++) if (!p.sol[k] && p.given[k] < 0) return k; return -1; });
  await q.click(`.pz .cell[data-i="${i}"]`);
  await q.waitForTimeout(60);
  const r = await q.evaluate((k) => ({ boom: document.querySelectorAll('.boom').length, hit: document.querySelector(`.pz .cell[data-i="${k}"]`).classList.contains('hit') }), i);
  if (r.boom || !r.hit) fail(`reduced motion should hit without the effect ${JSON.stringify(r)}`);
  await ctx.close();
}

async function forcedChecks(b, errs) {
  const fail = (m) => errs.push(`forced colors: ${m}`);
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, forcedColors: 'active' });
  const pg = await ctx.newPage();
  await pg.goto(BASE() + '?mode=mines');
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();
  await pg.waitForTimeout(400);
  await pg.evaluate(() => {
    const ch = ZoomLab.state().chains.mines;
    ZoomLab.advance('mines', ch);
    const p = ch.cur;
    const ink = [], empty = [];
    for (let i = 0; i < p.sol.length; i++) if (p.given[i] < 0) (p.sol[i] ? ink : empty).push(i);
    p.cells[ink[0]] = 1; p.cells[empty[0]] = 0;
    p.hit[empty[1]] = 1; p.hits = 1;
    ZoomLab.render();
  });
  await pg.waitForTimeout(1600);
  const look = await pg.evaluate(() => {
    const css = (sel, pseudo) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, pseudo) : null; };
    const clear = (c) => !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c);
    const open = css('.pz .cell:not(.ink):not(.mark):not(.given):not(.hit)', '::before');
    const ink = css('.pz .cell.ink:not(.given)', '::before');
    const mark = css('.pz .cell.mark', '::after');
    const held = css('.pz .cell.given.ink', '::before');
    const dash = css('.pz .cell.given:not(.ink)', '::after');
    const hit = css('.pz .cell.hit', '::before');
    return {
      open: !!open && parseFloat(open.borderTopWidth) >= 1 && open.borderTopStyle !== 'none',
      ink: !!ink && !clear(ink.backgroundColor) && ink.backgroundColor !== getComputedStyle(document.body).backgroundColor,
      mark: !!mark && !clear(mark.backgroundColor),
      held: !held || (held.backgroundImage !== 'none' && held.borderTopStyle === 'double'),
      dash: !dash || !clear(dash.backgroundColor),
      hit: !!hit && hit.outlineStyle === 'dashed',
    };
  });
  const missing = Object.entries(look).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) fail(`not drawn: ${missing.join(', ')}`);
  await pg.screenshot({ path: `${OUT}/forced-mines.png` });
  await ctx.close();
}
