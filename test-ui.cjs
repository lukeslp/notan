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
      await page.locator('#lvl-btn').click(); await page.locator('.lv').nth(27).click();
      await page.waitForFunction(() => document.activeElement.id === 'lvl-btn');
      await solve();
      assert.equal(await page.locator('#cap-name').textContent(), 'Leaf');
      await page.screenshot({ path: `/tmp/notan-leaf-${viewport.width}-${colorScheme}.png` });
      await page.locator('#next-btn').click();
      assert.equal(await page.locator('#lvl-text').textContent(), '29');
      await page.locator('#help-btn').click();
      assert.equal(await page.locator('#help #reset-all').count(), 0);
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
      assert.equal(await page.locator('#lvl-text').textContent(), '29');
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
      await cdp.detach();
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}x${viewport.height} ${colorScheme}: migration, quick play, leaf, next, keyboard, reset, zoom, theme before paint, background/cell holds; no console errors`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
