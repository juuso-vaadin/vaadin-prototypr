#!/usr/bin/env node
/**
 * check-viewer.cjs: end-to-end check of the viewer with Playwright (M2, docs/SPEC.md §5, §7.1).
 *
 *   node scripts/check-viewer.cjs [screenshot-dir]
 *
 * Playwright is not a project dependency: this uses whatever `require('playwright')`
 * resolves to (preinstalled in Claude Code cloud sessions; otherwise
 * `npm i -g playwright && npx playwright install chromium`).
 *
 * Starts its own server with GitHub Pages-like caching (scripts/serve.mjs --pages),
 * rebuilds manifest.json, then checks: prototype switching, the size menu and drag,
 * light/dark through the theme adapters (Aura and Lumo), variants, snapshots, deep
 * links and copy link, search, archived filter, history, no external requests, no
 * console errors, and the prototype-switch time against the ~500 ms target.
 */
// These checks drive the template's example prototypes. A customer site made with
// scripts/init-site.mjs has removed them, so the checks belong to the template repo.
if (!require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'prototypes', 'order-list-bulk-actions'))) {
  console.error('This check runs in the template repository: it uses the example prototypes, which this site has removed.');
  process.exit(2);
}

const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shots = path.resolve(process.argv[2] ?? path.join(root, 'test-results'));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;
const TARGET_MS = 500;
mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

(async () => {
  execFileSync('node', ['scripts/build-manifest.mjs'], { cwd: root, stdio: 'ignore' });
  const server = spawn('node', ['scripts/serve.mjs', String(PORT), '--pages'], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const external = [];
    const consoleErrors = [];
    context.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) external.push(r.url()); });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    // Errors inside the prototype frames are reported on the page too (same page).

    const readyCount = () => page.evaluate(() => window.__protoViewer?.readyCount ?? 0);
    async function waitReady(prev) {
      await page.waitForFunction((n) => (window.__protoViewer?.readyCount ?? 0) > n, prev, { timeout: 15000 });
      return page.evaluate(() => window.__protoViewer.lastReadyMs);
    }
    const frame = () => page.frameLocator('iframe.pv-frame');
    const frameInfo = () => page.evaluate(() => {
      const f = document.querySelector('iframe.pv-frame');
      const d = f.contentDocument;
      return {
        src: f.contentWindow.location.href,
        innerWidth: f.contentWindow.innerWidth,
        colorScheme: d.documentElement.style.colorScheme,
        themeAttr: d.documentElement.getAttribute('theme'),
        bodyBg: getComputedStyle(d.body).backgroundColor,
        htmlBg: getComputedStyle(d.documentElement).backgroundColor,
        textColor: getComputedStyle(d.body).color,
      };
    });
    const hashState = () => page.evaluate(() => location.hash);
    // Rough lightness 0..255 of a computed color (rgb() or oklch()).
    const lum = (c) => {
      const v = c.match(/[\d.]+/g).map(Number);
      if (c.startsWith('oklch')) return v[0] * 255;
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };

    // 1. Opening / picks the first prototype and writes it into the hash.
    let n = 0;
    await page.goto(BASE);
    const coldMs = await waitReady(n);
    check('opening / selects a prototype', /#\/p\/[a-z0-9-]+/.test(await hashState()), await hashState());
    check('cold first load measured', coldMs > 0, `${coldMs} ms`);

    // 2. Switch between all prototypes from the sidebar.
    const slugs = await page.$$eval('a.pv-item', (as) => as.map((a) => a.dataset.slug));
    check('sidebar lists ≥3 prototypes', slugs.length >= 3, slugs.join(', '));
    for (const slug of [...slugs.slice(1), slugs[0]]) {
      n = await readyCount();
      await page.click(`a.pv-item[data-slug="${slug}"]`);
      await waitReady(n);
      const info = await frameInfo();
      check(`switch to ${slug}`, info.src.includes(`/prototypes/${slug}/`) && (await hashState()).includes(`/p/${slug}`), info.src.replace(BASE, '/'));
      await page.screenshot({ path: path.join(shots, `switch-${slug}.png`) });
    }

    // 3. Widths: the size dropdown sets the iframe's own width (media queries see it).
    async function pickSize(id) {
      await page.click('[data-role=size] .pv-menu-button');
      await page.click(`[data-role=size] [role=menuitemradio][data-id="${id}"]`);
      await page.waitForTimeout(150);
    }
    const sizeLabel = () => page.$eval('[data-role=size] .pv-menu-button', (b) => b.textContent.replace(/\s+/g, ' ').trim());
    n = await readyCount();
    await page.click('a.pv-item[data-slug="order-list-bulk-actions"]');
    await waitReady(n);
    const offered = await page.$$eval('[data-role=size] [role=menuitemradio]:not([hidden])', (els) => els.map((e) => e.dataset.id));
    check('size menu offers Full, Phone, Tablet', offered.join() === 'full,phone,tablet', offered.join(', '));
    check('size defaults to Full', (await sizeLabel()) === 'Full' && !(await hashState()).includes('w='));
    for (const [id, w] of [['phone', 390], ['tablet', 768]]) {
      await pickSize(id);
      const info = await frameInfo();
      check(`size ${id}`, info.innerWidth === w && (await hashState()).includes(`w=${w}`) && (await sizeLabel()).includes(`${w} px`), `frame innerWidth ${info.innerWidth}, button "${await sizeLabel()}"`);
      await page.screenshot({ path: path.join(shots, `width-${id}.png`) });
    }
    await page.click('[data-role=size] .pv-menu-button');
    await page.screenshot({ path: path.join(shots, 'size-menu-open.png') });
    await page.keyboard.press('Escape');
    check('Escape closes the size menu', await page.$eval('.pv-menu-popup', (p) => p.hidden));
    await pickSize('full');
    const full = await frameInfo();
    const stageW = await page.$eval('.pv-canvas', (c) => c.clientWidth);
    check('Full fills the stage', !(await hashState()).includes('w=') && Math.abs(full.innerWidth - (stageW - 40)) <= 1, `${full.innerWidth}px of ${stageW}px stage`);

    // Custom width: dragging a handle (starting from Tablet), and a deep link wider than the stage.
    await pickSize('tablet');
    const handle = await page.$('.pv-handle[data-side="1"]');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const dragged = (await frameInfo()).innerWidth;
    check('custom width by dragging a handle', dragged === 888 && (await hashState()).includes(`w=${dragged}`), `768 → ${dragged}px (+2×60)`);
    check('custom width shows in the size button', (await sizeLabel()) === `Custom ${dragged} px`, await sizeLabel());
    await page.click('[data-role=size] .pv-menu-button');
    const customChecked = await page.$eval('[data-role=size] [data-id=custom]', (e) => !e.hidden && e.getAttribute('aria-checked') === 'true');
    await page.keyboard.press('Escape');
    check('custom width is a checked menu entry', customChecked);
    n = await readyCount();
    await page.goto(`${BASE}#/p/order-list-bulk-actions?w=1600`);
    await page.waitForTimeout(300);
    const wide = await frameInfo();
    check('a too-wide width is scaled to fit and the scale shown', wide.innerWidth === 1600 && /Custom 1600 px · \d+%/.test(await sizeLabel()), await sizeLabel());
    await pickSize('full');

    // 4. Light/dark through the adapters: Aura (color-scheme) and Lumo (theme="dark" too).
    const lightAura = await frameInfo();
    await page.click('[data-action=scheme]');
    await page.waitForTimeout(250);
    const darkAura = await frameInfo();
    check('Aura dark: color-scheme on <html>', darkAura.colorScheme === 'dark' && (await hashState()).includes('theme=dark'));
    check('Aura dark: page actually turns dark', lum(darkAura.textColor) > lum(lightAura.textColor) + 80, `text ${lightAura.textColor} → ${darkAura.textColor}`);
    await page.screenshot({ path: path.join(shots, 'aura-dark.png') });
    n = await readyCount();
    await page.click('a.pv-item[data-slug="customer-profile-edit"]');
    await waitReady(n);
    const darkLumo = await frameInfo();
    check('dark carries over to the next prototype', (await hashState()).includes('theme=dark'));
    check('Lumo dark: color-scheme on <html>', darkLumo.colorScheme === 'dark');
    check('Lumo dark: page actually turns dark', lum(darkLumo.htmlBg) < 90, `background ${darkLumo.htmlBg}`);
    await page.screenshot({ path: path.join(shots, 'lumo-dark.png') });
    await page.click('[data-action=scheme]');
    await page.waitForTimeout(250);
    const lightLumo = await frameInfo();
    check('Lumo back to light', lightLumo.colorScheme === 'light' && lum(lightLumo.htmlBg) > 200, `background ${lightLumo.htmlBg}`);
    check('theme toggle does not reload the prototype', (await readyCount()) === n + 1);

    // 5. Variants.
    n = await readyCount();
    await page.click('a.pv-item[data-slug="order-list-bulk-actions"]');
    await waitReady(n);
    check('variant switcher shown for 2 variants', await page.isVisible('[data-role=variant]'));
    n = await readyCount();
    await page.click('[data-role=variant] button[data-id=b]');
    await waitReady(n);
    let info = await frameInfo();
    const footerVisible = await frame().locator('[data-proto-id=selection-footer]').isVisible();
    check('variant b loads ?variant=b', info.src.endsWith('?variant=b') && footerVisible && (await hashState()).includes('variant=b'));
    await page.screenshot({ path: path.join(shots, 'variant-b.png') });
    n = await readyCount();
    await page.click('[data-role=variant] button[data-id=a]');
    await waitReady(n);
    check('variant a shows the toolbar', await frame().locator('[data-proto-id=bulk-toolbar]').isVisible());
    check('no variant switcher for a single-variant prototype', await (async () => {
      n = await readyCount();
      await page.click('a.pv-item[data-slug="customer-profile-edit"]');
      await waitReady(n);
      return !(await page.isVisible('[data-role=variant]'));
    })());

    // 6. Snapshots.
    n = await readyCount();
    await page.click('a.pv-item[data-slug="inventory-stock-alerts"]');
    await waitReady(n);
    n = await readyCount();
    await page.selectOption('[data-role=snapshot] select', 'v1');
    await waitReady(n);
    info = await frameInfo();
    const kpisInV1 = await frame().locator('[data-proto-id=kpi-cards]').count();
    check('snapshot v1 loads prototypes/<slug>/v1/', info.src.includes('/inventory-stock-alerts/v1/') && kpisInV1 === 0 && (await hashState()).includes('snapshot=v1'));
    await page.screenshot({ path: path.join(shots, 'snapshot-v1.png') });

    // 7. Deep link: build a specific view, copy the link, open it in a fresh page.
    n = await readyCount();
    await page.click('a.pv-item[data-slug="order-list-bulk-actions"]');
    await waitReady(n);
    n = await readyCount();
    await page.click('[data-role=variant] button[data-id=b]');
    await waitReady(n);
    await pickSize('phone');
    await page.click('[data-action=scheme]');
    await page.click('[data-action=copy]');
    await page.waitForTimeout(150);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('copy link copies the current URL', copied === page.url(), copied.replace(BASE, '/'));
    const before = await frameInfo();
    await page.screenshot({ path: path.join(shots, 'deeplink-source.png') });
    const page2 = await context.newPage();
    page2.on('pageerror', (e) => consoleErrors.push(e.message));
    await page2.goto(copied);
    await page2.waitForFunction(() => (window.__protoViewer?.readyCount ?? 0) > 0);
    await page2.waitForTimeout(200);
    const after = await page2.evaluate(() => {
      const f = document.querySelector('iframe.pv-frame');
      return {
        src: f.contentWindow.location.href,
        innerWidth: f.contentWindow.innerWidth,
        colorScheme: f.contentDocument.documentElement.style.colorScheme,
        variantChecked: document.querySelector('[data-role=variant] [aria-checked=true]')?.dataset.id,
        widthChecked: document.querySelector('[data-role=size] [role=menuitemradio][aria-checked=true]:not([hidden])')?.dataset.id,
        schemePressed: document.querySelector('[data-action=scheme]').getAttribute('aria-pressed'),
      };
    });
    check('deep link restores the exact view',
      after.src === before.src && after.innerWidth === 390 && after.colorScheme === 'dark' && after.variantChecked === 'b' && after.widthChecked === 'phone' && after.schemePressed === 'true',
      JSON.stringify(after).replace(BASE, '/'));
    await page2.screenshot({ path: path.join(shots, 'deeplink-restored.png') });
    await page2.close();

    // 8. History: back returns to the previous prototype.
    n = await readyCount();
    await page.click('a.pv-item[data-slug="inventory-stock-alerts"]');
    await waitReady(n);
    n = await readyCount();
    await page.evaluate(() => history.back());
    await waitReady(n);
    check('browser back restores the previous prototype', (await frameInfo()).src.includes('order-list-bulk-actions'));

    // 9. Search.
    await page.fill('.pv-search input', 'reorder');
    const hits = await page.$$eval('a.pv-item', (as) => as.map((a) => a.dataset.slug));
    check('search matches description text', hits.includes('inventory-stock-alerts') && hits.length <= 2, hits.join(', '));
    await page.fill('.pv-search input', 'lumo');
    check('search with no title match still finds description', (await page.$$eval('a.pv-item', (as) => as.length)) === 1);
    await page.fill('.pv-search input', '');

    // 10. Unknown slug and invalid variant.
    await page.goto(`${BASE}#/p/does-not-exist`);
    await page.waitForSelector('.pv-message:not([hidden])');
    check('unknown slug shows a message', (await page.textContent('.pv-message')).includes('does-not-exist'));
    await page.goto(`${BASE}#/p/order-list-bulk-actions?variant=zzz`);
    await page.waitForFunction(() => (window.__protoViewer?.readyCount ?? 0) > 0);
    check('unknown variant falls back to the first one', !(await hashState()).includes('variant=') && (await frameInfo()).src.endsWith('?variant=a'));

    // 11. Archived prototypes are hidden by default (manifest patched in the test).
    const archivedPage = await context.newPage();
    await archivedPage.route('**/manifest.json', async (route) => {
      const res = await route.fetch();
      const m = await res.json();
      m.prototypes.push({ ...m.prototypes[0], slug: 'old-thing', title: 'Old thing', status: 'archived' });
      await route.fulfill({ json: m });
    });
    await archivedPage.goto(`${BASE}#/p/order-list-bulk-actions`);
    await archivedPage.waitForSelector('a.pv-item');
    const hidden = (await archivedPage.$$('a.pv-item[data-slug="old-thing"]')).length === 0;
    await archivedPage.check('.pv-archived input');
    const shown = (await archivedPage.$$('a.pv-item[data-slug="old-thing"]')).length === 1;
    check('archived hidden by default, shown on toggle', hidden && shown);
    await archivedPage.close();

    // 12. Viewer on a phone (nice-to-have).
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(`${BASE}#/p/inventory-stock-alerts?w=390`);
    await phone.waitForFunction(() => (window.__protoViewer?.readyCount ?? 0) > 0);
    await phone.screenshot({ path: path.join(shots, 'viewer-on-phone.png') });
    await phone.click('[data-action=sidebar]');
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: path.join(shots, 'viewer-on-phone-list.png') });
    await phone.close();

    // 13. Switch timing (§7.1): click in the sidebar → prototype usable, warm cache.
    async function timeSwitches(pairs, rounds) {
      const times = [];
      for (let i = 0; i < rounds; i++) {
        for (const slug of pairs) {
          const prev = await readyCount();
          await page.click(`a.pv-item[data-slug="${slug}"]`);
          times.push(await waitReady(prev));
        }
      }
      times.sort((a, b) => a - b);
      const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
      return { n: times.length, min: times[0], median: q(0.5), p95: q(0.95), max: times[times.length - 1] };
    }
    await page.goto(`${BASE}#/p/order-list-bulk-actions`);
    await page.waitForFunction(() => (window.__protoViewer?.readyCount ?? 0) > 0);
    const timing = {};
    timing['aura ↔ aura'] = await timeSwitches(['inventory-stock-alerts', 'order-list-bulk-actions'], 10);
    timing['aura ↔ lumo'] = await timeSwitches(['customer-profile-edit', 'order-list-bulk-actions'], 10);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    timing['aura ↔ aura, CPU 4× slower'] = await timeSwitches(['inventory-stock-alerts', 'order-list-bulk-actions'], 5);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const [k, t] of Object.entries(timing)) {
      check(`switch time ${k}: median ${t.median} ms (target < ${TARGET_MS})`, k.includes('4×') || t.median < TARGET_MS, `n=${t.n} min ${t.min} · median ${t.median} · p95 ${t.p95} · max ${t.max} ms`);
    }

    check('no requests left the local server', external.length === 0, external.slice(0, 5).join(', '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
    console.log(`\ncold first load: ${coldMs} ms`);
    console.log(JSON.stringify({ coldMs, timing }, null, 2));
    console.log(`Screenshots: ${shots}`);
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
