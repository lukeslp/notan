// Run with PLAYWRIGHT and CHROME paths if they are not installed in the usual locations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
// playwright-core from PLAYWRIGHT, a normal install, or this author's server.
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT, 'playwright-core', '/home/coolhand/projects/spectre/node_modules/playwright-core'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* try the next */ } }
  throw new Error('playwright-core not found: npm i -D playwright-core && npx playwright install chromium, or set PLAYWRIGHT');
}
const { chromium } = loadPlaywright();
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://local').pathname;
  const file = path.join(__dirname, name === '/' ? 'index.html' : name);
  if (!file.startsWith(__dirname + '/') || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || [path.join(process.env.HOME || '', '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome')].find((f) => fs.existsSync(f)) });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 820 }]) for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' });
      // Keep analytics markup intact, but don't send test traffic.
      await context.route('https://stats.dr.eamer.dev/**', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(base);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.locator('#lvl-btn').click();
      assert.equal(await page.locator('#plus-section').isVisible(), false);
      assert.equal(await page.locator('#plus-grid button').count(), 0);
      await page.keyboard.press('Escape');
      await page.goto(base + '/?plus=1');
      assert.equal(await page.locator('#lvl-text').textContent(), '1');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      const old = { at: 'leaf', solved: { leaf: 125, square: 9 }, boards: { leaf: { c: '1'.repeat(64), t: 20 }, cup: { c: '100000000', t: 7 } }, endless: { size: 8, seed: 12, c: '0'.repeat(64), t: 6 }, mark: true, seen: true };
      await page.addInitScript(save => { if (!sessionStorage.getItem('old-save-seeded')) { localStorage.setItem('ink.v1', JSON.stringify(save)); sessionStorage.setItem('old-save-seeded', '1'); } }, old);
      await page.goto(base);
      let save = await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')));
      assert.equal(save.solved['leaf-connected'], 125);
      assert.equal(save.solved.square, 9);
      assert.equal(save.boards.leaf, undefined);
      assert.deepEqual(save.boards.cup, old.boards.cup);
      assert.deepEqual(save.endless, old.endless);
      assert.equal(save.mark, true); assert.equal(save.seen, true);
      assert.equal(await page.evaluate(() => window.__notan.S.puz.id), 'leaf-connected');
      assert.equal(await page.evaluate(() => window.__notan.S.cells.some(Boolean)), false);
      await page.locator('#settings-btn').focus(); await page.keyboard.press('Enter');
      for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => !!document.activeElement.closest('#settings')), true); }
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-btn');
      await page.locator('#settings-btn').click();
      await page.locator('#settings-sizes button', { hasText: /^8$/ }).click();
      await page.waitForFunction(() => document.activeElement.id === 'settings-btn');
      assert.equal(await page.locator('#lvl-text').textContent(), '∞ 8');
      assert.equal(await page.evaluate(() => window.__notan.S.cells.some(Boolean)), false);
      await page.reload();
      await page.locator('#settings-btn').click();
      assert.equal(await page.locator('#settings-sizes [aria-pressed="true"]').textContent(), '8');
      await page.keyboard.press('Escape');
      await page.locator('#lvl-btn').click();
      assert.equal(await page.locator('#levels #sizes').count(), 0);
      if (viewport.width === 390) assert.deepEqual(await page.locator('#levels').boundingBox(), { x: 0, y: 0, ...viewport });
      await page.screenshot({ path: `/tmp/notan-levels-${viewport.width}-${colorScheme}.png` });
      await page.keyboard.press('Escape');
      await page.locator('#settings-btn').click();
      await page.locator('#settings-sizes button', { hasText: /^5$/ }).click();
      await page.waitForFunction(() => document.querySelector('#lvl-text').textContent === '∞ 5');
      assert.equal(await page.locator('#lvl-text').textContent(), '∞ 5');
      // Solve through real keyboard input, using the engine only to identify filled cells.
      async function solve() {
        // Let the dialog's close handler restore focus before focusing the grid.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const { sol, w } = await page.evaluate(() => ({ sol: Array.from(window.__notan.S.puz.sol), w: window.__notan.S.puz.w }));
        await page.locator('.cell').first().focus();
        for (let i = 0; i < sol.length; i++) {
          if (sol[i]) await page.keyboard.press('Space');
          if (i + 1 < sol.length) {
            if ((i + 1) % w) await page.keyboard.press('ArrowRight');
            else { await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); }
          }
        }
        await page.waitForFunction(() => window.__notan.S.solved);
      }
      await solve();
      const seed = await page.evaluate(() => window.__notan.S.puz.seed);
      await page.mouse.move(12, 120); await page.mouse.down();
      await page.waitForTimeout(600); await page.mouse.up();
      assert.equal(await page.locator('#settings').evaluate(d => d.open), true);
      assert.equal(await page.evaluate(() => window.__notan.S.puz.seed), seed);
      await page.keyboard.press('Escape');

      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#lvl-text').textContent(), '∞ 5');
      assert.notEqual(await page.evaluate(() => window.__notan.S.puz.seed), seed);
      await solve();
      await page.locator('#settings-btn').click();
      await page.locator('#settings-sizes button', { hasText: /^12$/ }).click();
      assert.equal(await page.locator('#solved-sizes').count(), 0);
      assert.equal(await page.locator('#lvl-text').textContent(), '∞ 12');
      await page.locator('#lvl-btn').click(); await page.locator('#lv-grid .lv').nth(30).click();
      await page.waitForFunction(() => document.activeElement === document.querySelector('#grid .cell'));
      await solve();
      assert.equal(await page.locator('#cap-name').textContent(), 'Leaf');
      await page.screenshot({ path: `/tmp/notan-leaf-${viewport.width}-${colorScheme}.png` });
      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#lvl-text').textContent(), '32');
      await page.locator('#help-btn').click();
      assert.equal(await page.locator('#help #reset-all').count(), 0);
      assert.equal(await page.locator('#help .eg > li').count(), 4);
      assert.equal(await page.locator('#help .eg button, #help details').count(), 0);
      assert.equal(await page.locator('#help').getByText('Show me', { exact: true }).count(), 0);
      assert.equal(await page.locator('#help .eg-clue.locked').textContent(), '5');
      assert.match(await page.locator('#help .eg-note').nth(3).textContent(), /Hold again to unlock/);
      assert.equal(await page.locator('#help a').textContent(), 'lukesteuber.com');
      await page.screenshot({ path: `/tmp/notan-help-${viewport.width}-${colorScheme}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help-btn');
      await page.locator('#settings-btn').click();
      assert.equal(await page.locator('#settings').getAttribute('aria-label'), 'Settings');
      assert.equal(await page.locator('#settings h2').count(), 0);
      await page.locator('#reset-all').click();
      assert.equal(await page.locator('#reset-confirm').evaluate(d => d.open), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'reset-all');
      assert.equal(await page.locator('#lvl-text').textContent(), '32');
      await page.locator('#reset-all').click(); await page.locator('#confirm-reset').click();
      save = await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')));
      assert.deepEqual(save.solved, {}); assert.deepEqual(save.boards, {});
      assert.equal(await page.locator('#lvl-text').textContent(), '1');
      // Reset Level preserves the puzzle, quick-play seed, and completed levels.
      for (const quickPlay of [false, true]) {
        if (quickPlay) {
          await page.locator('#settings-btn').click();
          await page.locator('#settings-sizes button').first().click();
        }
        await page.locator('.cell').first().focus(); await page.keyboard.press('X');
        const puzzle = await page.evaluate(() => ({ id: __notan.S.puz.id, seed: __notan.S.puz.seed }));
        await page.locator('#settings-btn').click(); await page.locator('#reset-level').click();
        assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false);
        assert.deepEqual(await page.evaluate(() => ({ id: __notan.S.puz.id, seed: __notan.S.puz.seed })), puzzle);
        await page.waitForFunction(() => document.activeElement.id === 'settings-btn');
      }
      await page.locator('#settings-btn').click();
      await page.locator('#settings-sizes button', { hasText: /^15$/ }).click();
      const baseFont = await page.locator('.clue').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      for (const zoom of [100, 115, 130, 150]) {
        await page.locator('#settings-btn').click();
        await page.getByRole('button', { name: zoom + ' percent', exact: true }).click();
        assert.equal(await page.locator('#zoom-sizes [aria-pressed="true"]').textContent(), String(zoom));
        const contrast = await page.locator('#settings').evaluate(dialog => {
          const luminance = color => {
            const rgb = color.match(/\d+/g).slice(0, 3).map(Number).map(v => {
              v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
            });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          const bg = luminance(getComputedStyle(dialog).backgroundColor);
          return [...dialog.querySelectorAll('h3, .size-choice')].every(e => {
            const ink = luminance(getComputedStyle(e).color);
            return (Math.max(bg, ink) + .05) / (Math.min(bg, ink) + .05) >= 4.5;
          });
        });
        assert(contrast, 'Settings text meets AA contrast');
        const choices = await page.locator('#settings-sizes button').evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().top));
        assert(choices.every(top => top === choices[0]), 'Quick play stays in one row');
        const geometry = await page.locator('#settings').evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
        assert.equal(geometry.width, geometry.scroll);
        await page.keyboard.press('Escape');
        const bounds = await page.locator('#board').boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
        assert(bounds.y >= 50 && bounds.y + bounds.height <= viewport.height - 54);
      }
      assert(await page.locator('.clue').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize)) > baseFont);
      await page.reload(); await page.locator('#settings-btn').click();
      assert.equal(await page.locator('#zoom-sizes [aria-pressed="true"]').textContent(), '150');
      await context.route('**/notan.js', async route => { await new Promise(resolve => setTimeout(resolve, 150)); await route.continue(); });
      // Record the first animation frame, before that frame is painted.
      await page.addInitScript(() => {
        requestAnimationFrame(() => {
          window.earlyAppearance = {
            theme: document.documentElement.dataset.theme || 'system',
            background: getComputedStyle(document.documentElement).backgroundColor,
          };
        });
      });
      for (const [theme, nextTheme] of [['light', 'dark'], ['dark', 'system'], ['system', 'light']]) {
        await page.locator('#theme-btn').click();
        assert.equal(await page.locator('#theme-btn').getAttribute('aria-label'), `Theme: ${theme}. Switch to ${nextTheme}.`);
        await page.reload();
        await page.waitForFunction(() => window.earlyAppearance);
        assert.equal(await page.evaluate(() => window.earlyAppearance.theme), theme);
        const effective = theme === 'system' ? colorScheme : theme;
        assert.equal(await page.evaluate(() => window.earlyAppearance.background), effective === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
        assert.equal(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor), effective === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
        await page.locator('#settings-btn').click();
      }
      await page.screenshot({ path: `/tmp/notan-settings-${viewport.width}-${colorScheme}.png` });
      await page.keyboard.press('Escape');
      // Real touch input exercises both hold recognizers and native pointer capture.
      const cdp = await context.newCDPSession(page);
      async function touch(type, x, y) {
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      }
      await touch('touchStart', 12, 120); await page.waitForTimeout(600); await touch('touchEnd');
      assert.equal(await page.locator('#settings').evaluate(d => d.open), true);
      await page.keyboard.press('Escape');
      await touch('touchStart', 12, 120); await touch('touchMove', 12, 150); await page.waitForTimeout(600); await touch('touchEnd');
      assert.equal(await page.locator('#settings').evaluate(d => d.open), false);
      if (await page.locator('#mode-btn').getAttribute('aria-pressed') === 'true') await page.locator('#mode-btn').click();
      const cell = await page.locator('.cell').first().boundingBox();
      await touch('touchStart', cell.x + cell.width / 2, cell.y + cell.height / 2);
      await page.waitForTimeout(600); await touch('touchEnd');
      assert.equal(await page.locator('.cell').first().evaluate(e => e.classList.contains('mark')), true);
      assert.equal(await page.locator('#settings').evaluate(d => d.open), false);
      // Immediate taps, double-tap replacement, path interpolation, and visual cues.
      assert.equal(await page.locator('#clear-btn').count(), 0);
      assert.equal(await page.locator('.bar [aria-label="Board"] button').count(), 2);
      await page.goto(base + '/?endless=10&seed=42');
      async function resetLevel() {
        await page.locator('#settings-btn').click(); await page.locator('#reset-level').click();
        await page.waitForFunction(() => document.activeElement.id === 'settings-btn');
      }
      await resetLevel();
      const squares = page.locator('#grid .cell');
      async function point(i) { const b = await squares.nth(i).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
      async function tap(i) { const p = await point(i); await touch('touchStart', p.x, p.y); await touch('touchEnd'); }
      const origin = await point(0);
      const before = await page.evaluate(() => __notan.S.undo.length);
      await touch('touchStart', origin.x, origin.y);
      assert.equal(await squares.first().evaluate(e => e.classList.contains('ink')), true, 'Fill is immediate');
      await touch('touchEnd'); await tap(0);
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 2);
      assert.equal(await page.evaluate(() => __notan.S.undo.length), before + 1);
      await page.keyboard.press('z');
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 0);
      await squares.first().focus(); await page.keyboard.press('X');
      await tap(0); await tap(0);
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 0, 'Double-tap dotted square clears');
      await page.keyboard.press('z');
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 2);
      await resetLevel();
      // Sparse diagonal samples then a turn: no rectangle or skipped cells.
      const end = await point(44), turn = await point(40);
      await page.mouse.move(origin.x, origin.y); await page.mouse.down();
      await page.mouse.move(end.x, end.y); await page.mouse.move(turn.x, turn.y); await page.mouse.up();
      const pathCells = [0, 11, 22, 33, 40, 41, 42, 43, 44];
      assert.deepEqual(await page.evaluate(() => Array.from(__notan.S.cells).flatMap((v, i) => v === 1 ? [i] : [])), pathCells);
      await page.keyboard.press('z');
      assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false);
      await page.locator('#mode-btn').click();
      assert.equal(await page.locator('#mode-btn').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#mode-btn').evaluate(e => getComputedStyle(e).backgroundColor), colorScheme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
      await page.locator('#mode-btn').click();
      await squares.nth(4).focus(); await page.keyboard.press('Space');
      const guides = await squares.nth(4).evaluate(e => ({ line: getComputedStyle(e).boxShadow, fill: getComputedStyle(e, '::before').boxShadow, bg: getComputedStyle(document.body).backgroundColor }));
      assert.match(guides.line, /-2px/);
      assert.match(guides.fill, /-2px/);
      assert(guides.fill.includes(guides.bg), 'Guide contrasts with filled square');
      // Force focus to move between synchronous native restoration and the queued
      // close event. The old handler stole it, so Space reopened Settings and the
      // next Space generated a different puzzle while this test kept the old solution.
      await page.locator('#settings-btn').click();
      const resetFocus = await page.evaluate(async () => {
        const dialog = document.querySelector('#settings');
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
        document.querySelector('#reset-level').click();
        const nativeFocus = document.activeElement.id;
        const first = document.querySelector('#grid .cell');
        first.focus();
        await closed;
        return { nativeFocus, keptCell: document.activeElement === first,
          seed: __notan.S.puz.seed, drag: __notan.S.drag, pending: __notan.S.pending, lastTap: __notan.S.lastTap };
      });
      assert.deepEqual(resetFocus, { nativeFocus: 'settings-btn', keptCell: true,
        seed: 42, drag: null, pending: null, lastTap: null });
      await page.keyboard.press('x');
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 2);
      await page.keyboard.press('Delete');
      const solRow = await page.evaluate(() => Array.from(__notan.S.puz.sol).slice(0, 10));
      // A run counts as finished only when closed off by a dot or the edge, so dot the empties too
      // (the board is random, so the row's runs don't always touch the edges).
      for (let i = 0; i < 10; i++) { await squares.nth(i).focus(); await page.keyboard.press(solRow[i] ? 'Space' : 'x'); }
      assert.deepEqual(await page.evaluate(() => ({ seed: __notan.S.puz.seed,
        row: Array.from(__notan.S.cells).slice(0, 10) })),
      { seed: 42, row: solRow.map(v => v ? 1 : 2) });
      // Completed clues reflect the row after each move.
      await page.locator('.rc').first().locator('.n-done').first().waitFor({ timeout: 3000 });
      assert.equal(await page.locator('.rc .n-done').first().evaluate(e => getComputedStyle(e).textDecorationLine), 'line-through');
      await resetLevel();
      // Hold converts the immediate fill, then paints a marked path in one move.
      const holdStart = await point(0), holdEnd = await point(3);
      await touch('touchStart', holdStart.x, holdStart.y); await page.waitForTimeout(420);
      await touch('touchMove', holdEnd.x, holdEnd.y); await touch('touchEnd');
      assert.deepEqual(await page.evaluate(() => Array.from(__notan.S.cells).slice(0, 4)), [2, 2, 2, 2]);
      await page.keyboard.press('z');
      assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false);
      await squares.first().focus(); await page.keyboard.press('Space');
      await page.mouse.move(holdStart.x, holdStart.y); await page.mouse.down();
      await page.mouse.move(holdEnd.x, holdEnd.y); await page.mouse.up();
      assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false, 'Filled start clears the path');
      await resetLevel();
      await tap(0); await page.waitForTimeout(330); await tap(0);
      assert.equal(await page.evaluate(() => __notan.S.cells[0]), 0, 'Later tap clears normally');
      await resetLevel();
      await tap(0); await tap(1);
      assert.deepEqual(await page.evaluate(() => Array.from(__notan.S.cells).slice(0, 2)), [1, 1], 'Different cells do not double-tap');
      // A final solving fill can still be replaced by the second tap.
      await page.goto(base + '/?level=1'); await resetLevel();
      await page.locator('.cell').nth(0).focus(); await page.keyboard.press('Space');
      await page.locator('.cell').nth(1).focus(); await page.keyboard.press('Space');
      await page.locator('.cell').nth(2).focus(); await page.keyboard.press('Space');
      await tap(3); await tap(3);
      assert.equal(await page.evaluate(() => __notan.S.solved), false);
      assert.equal(await page.evaluate(() => __notan.S.cells[3]), 2);
      await page.keyboard.press('z');
      assert.equal(await page.evaluate(() => __notan.S.cells[3]), 0);
      // Locks are board state, independent of move history, on levels and quick play.
      for (const quickPlay of [false, true]) {
        await page.goto(base + (quickPlay ? '/?endless=5&seed=42' : '/?level=2'));
        assert.equal(await page.evaluate(() => !!__notan.S.puz.endless), quickPlay);
        await page.locator('#settings-btn').click(); await page.locator('#reset-level').click();
        if (await page.locator('#mode-btn').getAttribute('aria-pressed') === 'true') await page.locator('#mode-btn').click();
        const cells = page.locator('#grid .cell');
        const w = await page.evaluate(() => __notan.S.puz.w);
        async function center(locator) { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
        async function hold(locator, move = false) {
          const p = await center(locator);
          await touch('touchStart', p.x, p.y);
          if (move) await touch('touchMove', p.x, p.y + 12);
          await page.waitForTimeout(600); await touch('touchEnd');
        }
        const row = page.locator('#grid .rc').nth(1);
        await hold(row, true);
        assert.equal(await row.evaluate(e => e.classList.contains('locked')), false, 'Moving cancels clue hold');
        await cells.nth(w).click();
        await hold(row);
        assert.match(await row.getAttribute('aria-label'), /^Row 2, locked/);
        assert.equal(await page.locator('dialog[open]').count(), 0);
        const lockedPoint = await center(cells.nth(w));
        await touch('touchStart', lockedPoint.x, lockedPoint.y); await touch('touchEnd');
        await cells.nth(w).click();
        await cells.nth(w).click({ button: 'right' });
        await hold(cells.nth(w));
        await cells.nth(w).focus();
        for (const key of ['Space', 'Enter', 'X', 'Delete', 'Backspace']) await page.keyboard.press(key);
        assert.equal(await cells.nth(w).getAttribute('aria-readonly'), 'true');
        assert.equal(await page.evaluate(w => __notan.S.cells[w], w), 1);
        const a = await center(cells.first()), b = await center(cells.nth(2 * w));
        await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
        assert.deepEqual(await page.evaluate(w => [__notan.S.cells[0], __notan.S.cells[w], __notan.S.cells[2 * w]], w), [1, 1, 1]);
        await page.keyboard.press('z'); await page.keyboard.press('z');
        assert.equal(await page.evaluate(w => __notan.S.cells[w], w), 0, 'Undo can change locked cells');
        assert.equal(await row.evaluate(e => e.classList.contains('locked')), true);
        // Cross a locked blank row: only the cells before and after it fill.
        await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
        assert.deepEqual(await page.evaluate(w => [__notan.S.cells[0], __notan.S.cells[w], __notan.S.cells[2 * w]], w), [1, 0, 1]);
        await page.keyboard.press('z');
        await cells.first().focus(); await page.keyboard.press('Space'); await page.keyboard.press('Shift+ArrowDown');
        assert.equal(await page.evaluate(w => __notan.S.cells[w], w), 0, 'Keyboard painting skips locked cells');
        await page.keyboard.press('z');
        await cells.first().focus(); await page.keyboard.press('Shift+L');
        assert.match(await page.locator('#grid .cc').first().getAttribute('aria-label'), /^Column 1, locked/);
        await cells.first().click();
        assert.equal(await page.evaluate(() => __notan.S.cells[0]), 0);
        await page.reload();
        assert.equal(await page.locator('#grid .locked').count(), 2);
        await row.click({ button: 'right' });
        assert.equal(await row.evaluate(e => e.classList.contains('locked')), false);
        await cells.first().focus(); await page.keyboard.press('Shift+L');
        await cells.nth(w).focus(); await page.keyboard.press('l'); await page.keyboard.press('l');
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(w => __notan.S.cells[w], w), 1, 'Unlock restores filling');
        await page.keyboard.press('Delete');
        assert.equal(await page.evaluate(w => __notan.S.cells[w], w), 0, 'Unlock restores clearing');
        const column = page.locator('#grid .cc').first();
        await hold(column);
        assert.match(await column.getAttribute('aria-label'), /^Column 1, locked/);
        await hold(column);
        assert.match(await column.getAttribute('aria-label'), /^Column 1, unlocked/);
        // Blank boards also retain locks, and Start over clears those locks.
        await page.locator('#settings-btn').click(); await page.locator('#reset-level').click();
        await hold(row);
        await page.reload();
        assert.equal(await page.locator('#grid .locked').count(), 1);
        await page.locator('#settings-btn').click(); await page.locator('#reset-level').click();
        await page.reload();
        assert.equal(await page.locator('#grid .locked').count(), 0);
        assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false);
        // A fully filled row can stay locked through solving; finish drops locks.
        const sol = await page.evaluate(() => Array.from(__notan.S.puz.sol));
        for (let i = 0; i < w; i++) if (sol[i]) { await cells.nth(i).focus(); await page.keyboard.press('Space'); }
        await cells.first().focus(); await page.keyboard.press('l');
        for (let i = w; i < sol.length; i++) if (sol[i]) { await cells.nth(i).focus(); await page.keyboard.press('Space'); }
        assert.equal(await page.evaluate(() => __notan.S.solved), true);
        assert.equal(await page.locator('#grid .locked').count(), 0);
        const saved = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ink.v1')); return __notan.S.puz.endless ? s.endless : s.boards[__notan.S.puz.id]; });
        assert(!saved || !saved.locks, 'Solved saves drop locks');
      }
      // Seed on the next document, after the departing page has saved its board.
      await page.addInitScript(() => {
        const seed = sessionStorage.getItem('notan-test-save');
        if (seed) {
          localStorage.setItem('ink.v1', seed);
          sessionStorage.removeItem('notan-test-save');
        }
      });
      // All replaced ids preserve completion credit (including a zero-second solve),
      // discard stale cells, and migrate the current id through every redraw.
      // Both generations of old Robot also unlock +.
      const migrations = {
        leaf: 'leaf-connected', boat: 'boat-sail',
        goggles: 'goggles-tilted', alien: 'alien-antenna', robot: 'robot-wave',
        jellyfish: 'jellyfish-drift', mountain: 'mountain-ridge', crab: 'crab-raised',
        lion: 'lion-profile', beetle: 'beetle-angled',
        'alien-bold': 'alien-antenna', 'goggles-bold': 'goggles-tilted', 'robot-bold': 'robot-wave',
      };
      for (const [oldId, newId] of Object.entries(migrations)) for (const time of [0, 125]) {
        await page.evaluate(({ oldId, time }) => sessionStorage.setItem('notan-test-save', JSON.stringify({
          at: oldId, solved: { [oldId]: time }, boards: { [oldId]: { c: '1'.repeat(225) } },
        })), { oldId, time });
        await page.goto(base);
        const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')));
        assert.deepEqual(migrated.solved, { [newId]: time });
        assert.equal(migrated.solved[oldId], undefined);
        assert.equal(migrated.boards[oldId], undefined);
        // Beetle and Jellyfish players resume on the gentler board now ahead of them.
        const resumeAt = { 'beetle-angled': 'moth', 'jellyfish-drift': 'lantern' }[newId] || newId;
        assert.equal(migrated.at, resumeAt);
        assert.equal(await page.evaluate(() => __notan.S.puz.id), resumeAt);
        assert.equal(await page.evaluate(() => __notan.S.cells.some(Boolean)), false);
        assert.equal(migrated.plusUnlocked, newId === 'robot-wave');
      }
      // The two steep steps moved (Moth before Beetle; Lantern and Crab before
      // Jellyfish). A player waiting at either wall resumes once on the first
      // unsolved board now ahead of it; after that, the saved place holds.
      for (const [at, solved, want] of [
        ['beetle-angled', { 'lion-profile': 30 }, 'moth'],
        ['jellyfish-drift', { lantern: 40 }, 'crab-raised'],
        ['beetle-angled', { moth: 50 }, 'beetle-angled'],
      ]) {
        await page.evaluate(s => sessionStorage.setItem('notan-test-save', JSON.stringify(s)), { at, solved });
        await page.goto(base);
        assert.equal(await page.evaluate(() => __notan.S.puz.id), want);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')).rampOrder), 2);
      }
      await page.evaluate(() => sessionStorage.setItem('notan-test-save', JSON.stringify({ at: 'beetle-angled', rampOrder: 2 })));
      await page.goto(base);
      assert.equal(await page.evaluate(() => __notan.S.puz.id), 'beetle-angled');
      assert.equal(await page.locator('#lvl-text').textContent(), '50');

      // Hint from How to play: a wrong square gets a dashed ring and focus, the
      // level is flagged as hinted, and the next move clears the ring.
      await page.evaluate(() => sessionStorage.setItem('notan-test-save', JSON.stringify({ at: 'cup', boards: { cup: { c: '111000000', t: 5 } } })));
      await page.goto(base + '/?level=2');
      await page.locator('#help-btn').click();
      await page.locator('#help-hint-btn').click();
      assert.equal(await page.locator('#help').evaluate(d => d.open), false);
      assert.deepEqual(await page.evaluate(() => ({ i: __notan.S.hint.i, wrong: __notan.S.hint.wrong })), { i: 1, wrong: true });
      assert.equal(await page.locator('.hint.on.wrong').isVisible(), true);
      await page.waitForFunction(() => /row 1, column 2 is wrong/.test(document.querySelector('#live').textContent));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.cell')].indexOf(document.activeElement)), 1);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')).boards.cup.h), true);
      await page.keyboard.press('Space');
      assert.equal(await page.locator('.hint').isVisible(), false);
      assert.equal(await page.evaluate(() => __notan.S.hint), null);
      // Hint from Settings on a correct board: a solid ring on a square to fill,
      // with the clue that settles it outlined.
      await page.locator('#settings-btn').click();
      await page.locator('#hint-btn').click();
      const nextHint = await page.evaluate(() => ({ wrong: !!__notan.S.hint.wrong, fill: __notan.S.puz.sol[__notan.S.hint.i] }));
      assert.deepEqual(nextHint, { wrong: false, fill: 1 });
      assert.equal(await page.locator('#grid .clue.hinted').count(), 1);
      assert.equal(await page.locator('.hint.on:not(.wrong)').isVisible(), true);
      await page.screenshot({ path: `/tmp/notan-hint-${viewport.width}-${colorScheme}.png` });
      // The flag survives a reload and a reset; the hinted solve counts, and the save notes the hint.
      await page.reload();
      assert.equal(await page.evaluate(() => __notan.S.hinted), true);
      await resetLevel();
      await solve();
      const hintedSave = await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')));
      assert.equal(typeof hintedSave.solved.cup, 'number');
      assert.equal(hintedSave.hinted.cup, true);
      assert.equal(hintedSave.boards.cup, undefined);
      assert.equal(hintedSave.at, 'plus');
      // A faster solve without a hint replaces the best time and clears the note.
      await page.goto(base + '/?level=2');
      assert.equal(await page.evaluate(() => __notan.S.hinted), false);
      await solve();
      const cleanSave = await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')));
      assert(cleanSave.solved.cup < hintedSave.solved.cup);
      assert.equal(cleanSave.hinted.cup, undefined);
      // Hand the New Game+ checks below the unlocked save they expect.
      await page.evaluate(() => sessionStorage.setItem('notan-test-save', JSON.stringify({ at: 'robot-wave', solved: { 'robot-wave': 125 } })));
      await page.goto(base + '/?plus=1');
      assert.equal(await page.locator('#lvl-text').textContent(), '+1');
      // Locked URL falls back to the saved main level, even with saved + progress.
      await page.evaluate(() => sessionStorage.setItem('notan-test-save', JSON.stringify({ at: 'cup', solved: { 'plus-submarine': 1 } })));
      await page.goto(base + '/?plus=1');
      assert.equal(await page.locator('#lvl-text').textContent(), '2');
      // Solve the final board with actual keyboard input after seeding all but one ink cell.
      await page.evaluate(() => {
        const p = __notan.RAMP[52], c = Array.from(p.sol);
        c[c.indexOf(1)] = 0;
        sessionStorage.setItem('notan-test-save', JSON.stringify({ at: p.id, boards: { [p.id]: { c: c.join(''), t: 42 } } }));
      });
      await page.goto(base + '/?level=53');
      assert.equal(await page.locator('#unlock-notice').isVisible(), false);
      await page.locator('#lvl-btn').click();
      assert.equal(await page.locator('#plus-section').isVisible(), false);
      await page.keyboard.press('Escape');
      const missing = await page.evaluate(() => Array.from(__notan.S.puz.sol).findIndex((v, i) => v && !__notan.S.cells[i]));
      await page.locator('.cell').nth(missing).focus(); await page.keyboard.press('Space');
      await page.waitForFunction(() => __notan.S.solved);
      assert.equal(await page.locator('#unlock-notice').textContent(), 'New Game+ unlocked');
      assert.equal(await page.locator('#unlock-notice').isVisible(), true);
      await page.screenshot({ path: `/tmp/notan-unlocked-${viewport.width}-${colorScheme}.png` });
      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#lvl-text').textContent(), '+1');
      await page.waitForFunction(() => document.querySelector('#live').textContent.includes('New Game+ unlocked'));
      assert.match(page.url(), /\?plus=1$/);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.locator('#lvl-btn').click();
      assert.equal(await page.locator('#plus-section').isVisible(), true);
      assert.equal(await page.locator('#plus-grid button').count(), 20);
      assert.equal(await page.locator('#plus-grid [aria-current="true"]').textContent(), '1');
      await page.locator('#plus-grid button').nth(2).click();
      assert.equal(await page.locator('#lvl-text').textContent(), '+3');
      await page.reload();
      assert.equal(await page.locator('#lvl-text').textContent(), '+3');
      await page.goto(base + '/?plus=1');
      assert.equal(await page.locator('#lvl-text').textContent(), '+1');
      // + progress uses ids and survives navigation; its final Next returns to Levels.
      await page.evaluate(() => {
        const p = __notan.PLUS[19];
        const save = JSON.parse(localStorage.getItem('ink.v1'));
        save.boards[p.id] = { c: Array.from(p.sol).join(''), t: 80 };
        sessionStorage.setItem('notan-test-save', JSON.stringify(save));
      });
      await page.goto(base + '/?plus=20');
      assert.equal(await page.evaluate(() => __notan.S.solved), true);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ink.v1')).solved[__notan.PLUS[19].id]), 80);
      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#levels').evaluate(d => d.open), true);
      await page.keyboard.press('Escape');
      await page.locator('#settings-btn').click();
      await page.locator('#reset-all').click(); await page.locator('#confirm-reset').click();
      await page.goto(base + '/?plus=1');
      assert.equal(await page.locator('#lvl-text').textContent(), '1');
      await page.locator('#lvl-btn').click();
      assert.equal(await page.locator('#plus-section').isVisible(), false);
      await page.keyboard.press('Escape');
      await cdp.detach();
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}x${viewport.height} ${colorScheme}: double-tap/undo, snake paths, guides, strikethrough, all redraw migrations, ramp resume, hints, New Game+ gating/unlock/URLs/reset, quick play, leaf, next, keyboard, reset, zoom, theme before paint, background/cell holds, line locks, persistence, undo independence, solved cleanup; no console errors`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
