#!/usr/bin/env node
/**
 * check-comments.cjs: end-to-end check of comments (SPEC.md §6, M3) with Playwright.
 *
 *   node scripts/check-comments.cjs [screenshot-dir]
 *
 * Part 1 uses the "this browser only" backend: pins, comment mode, replies, edit,
 * delete, resolve/reopen, counts, variants, version badges, pins staying on their
 * element across widths, deep links to a thread.
 * Part 2 uses a mock Supabase (served by Playwright's request routing) that follows
 * the rules of supabase/schema.sql: anonymous identities, membership by comment
 * password (rate-limited), author names from the membership, authors edit/delete only
 * their own comments, threads accept only status changes, a password change signs
 * everyone out. Two signed-in browsers see each other's comments; a browser that
 * hasn't signed in sees none. It does not replace a test against a real Supabase
 * project (the SQL rules themselves are tested against Postgres separately).
 * Part 3: the setup guide and "backend": "none".
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shots = path.resolve(process.argv[2] ?? path.join(root, 'test-results', 'comments'));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;
const SB = 'https://mock.supabase.test';
const PASSWORD = 'acme-comment-pw';
mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// ---------------------------------------------------------------------------------
// Mock Supabase (Auth + the PostgREST calls the viewer makes)
// ---------------------------------------------------------------------------------
function createMockSupabase() {
  const db = {
    projects: [
      { id: randomUUID(), slug: 'acme', name: 'ACME Corp', password: PASSWORD, version: 1 },
      { id: randomUUID(), slug: 'other', name: 'Other Co', password: 'other-pw', version: 1 },
    ],
    users: new Map(), members: [], attempts: [], threads: [], comments: [],
  };
  const stats = { threadReads: {} };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  const isMember = (uid, pid) => db.members.some((m) => m.user_id === uid && m.project_id === pid && m.version === db.projects.find((p) => p.id === pid).version);

  async function handle(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const h = req.headers();
    if (h.apikey !== 'sb_publishable_test') return json(route, 401, { message: 'Invalid API key' });
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const issue = (id) => {
      const at = `at-${randomUUID()}`;
      db.users.set(at, id);
      return { access_token: at, refresh_token: `rt-${id}`, expires_in: 3600, user: { id } };
    };
    if (url.pathname === '/auth/v1/signup') return json(route, 200, issue(randomUUID()));
    if (url.pathname === '/auth/v1/token') return json(route, 200, issue(String(body.refresh_token).replace(/^rt-/, '')));
    if (!url.pathname.startsWith('/rest/v1/')) return json(route, 404, { message: 'not found' });
    const uid = db.users.get((h.authorization ?? '').replace(/^Bearer /, ''));
    if (!uid) return json(route, 401, { message: 'JWT invalid' });
    const path = url.pathname.slice('/rest/v1/'.length);
    const eq = (k) => url.searchParams.get(k)?.replace(/^eq\./, '');
    const now = () => new Date().toISOString();
    const bySlug = (slug) => db.projects.find((p) => p.slug === slug);

    // ---- functions (rpc) ----
    if (path === 'rpc/project_public') { const p = bySlug(body.p_slug); return json(route, 200, p ? [{ slug: p.slug, name: p.name }] : []); }
    if (path === 'rpc/my_membership') {
      const p = bySlug(body.p_slug);
      const m = p && isMember(uid, p.id) && db.members.find((x) => x.user_id === uid && x.project_id === p.id);
      return json(route, 200, m ? [{ project_id: p.id, project_name: p.name, display_name: m.name, email: m.email }] : []);
    }
    if (path === 'rpc/join_project') {
      const p = bySlug(body.p_slug);
      if (!p) return json(route, 200, { ok: false, reason: 'unknown-project' });
      if (!body.p_name?.trim()) return json(route, 200, { ok: false, reason: 'invalid-name' });
      const recent = (f) => db.attempts.filter((a) => !a.ok && f(a) && Date.now() - a.at < 15 * 60000).length;
      if (recent((a) => a.uid === uid) >= 5 || recent((a) => a.pid === p.id) >= 50) return json(route, 200, { ok: false, reason: 'too-many-attempts' });
      if (body.p_password !== p.password) { db.attempts.push({ uid, pid: p.id, ok: false, at: Date.now() }); return json(route, 200, { ok: false, reason: 'wrong-password' }); }
      db.members = db.members.filter((m) => !(m.user_id === uid && m.project_id === p.id));
      db.members.push({ user_id: uid, project_id: p.id, name: body.p_name.trim(), email: body.p_email, version: p.version });
      return json(route, 200, { ok: true, project: { id: p.id, slug: p.slug, name: p.name } });
    }
    if (path === 'rpc/set_my_name') {
      const p = bySlug(body.p_slug);
      const m = db.members.find((x) => x.user_id === uid && x.project_id === p?.id);
      if (m) Object.assign(m, { name: body.p_name.trim(), email: body.p_email });
      return json(route, 200, !!m);
    }
    if (path === 'rpc/leave_project') {
      const p = bySlug(body.p_slug);
      db.members = db.members.filter((m) => !(m.user_id === uid && m.project_id === p?.id));
      return json(route, 200, null);
    }

    // ---- tables (RLS: members of the thread's project only) ----
    const visibleThreads = () => db.threads.filter((t) => isMember(uid, t.project_id));
    if (path === 'threads' && req.method() === 'GET') {
      stats.threadReads[uid] = (stats.threadReads[uid] ?? 0) + 1;
      let rows = visibleThreads();
      for (const k of ['project_id', 'prototype_slug', 'status']) if (eq(k)) rows = rows.filter((t) => t[k] === eq(k));
      rows = rows.sort((a, b) => a.created_at.localeCompare(b.created_at)).map((t) => ({
        ...t,
        comments: db.comments.filter((c) => c.thread_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }));
      return json(route, 200, rows);
    }
    if (path === 'threads' && req.method() === 'POST') {
      if (!isMember(uid, body.project_id)) return json(route, 403, { message: 'new row violates row-level security policy for table "threads"' });
      const row = { ...body, id: randomUUID(), status: 'open', created_by: uid, created_at: now(), resolved_at: null, resolved_by: null };
      db.threads.push(row);
      return json(route, 201, [row]);
    }
    if (path === 'threads' && req.method() === 'PATCH') {
      if (Object.keys(body).some((k) => k !== 'status')) return json(route, 403, { message: 'permission denied for table threads' });
      const t = visibleThreads().find((x) => x.id === eq('id'));
      if (t) Object.assign(t, { status: body.status, resolved_at: body.status === 'resolved' ? now() : null, resolved_by: body.status === 'resolved' ? uid : null });
      return json(route, 204);
    }
    if (path === 'comments' && req.method() === 'POST') {
      if (Object.keys(body).some((k) => !['thread_id', 'body'].includes(k))) return json(route, 403, { message: 'permission denied for table comments' });
      const t = visibleThreads().find((x) => x.id === body.thread_id);
      if (!t) return json(route, 403, { message: 'new row violates row-level security policy for table "comments"' });
      const m = db.members.find((x) => x.user_id === uid && x.project_id === t.project_id);
      const row = { ...body, id: randomUUID(), author_id: uid, author_name: m.name, author_email: m.email ?? null, created_at: now(), edited_at: null };
      db.comments.push(row);
      return json(route, 201, [row]);
    }
    if (path === 'comments' && (req.method() === 'PATCH' || req.method() === 'DELETE')) {
      const c = db.comments.find((x) => x.id === eq('id') && x.author_id === uid && visibleThreads().some((t) => t.id === x.thread_id));
      if (c && req.method() === 'PATCH') {
        if (Object.keys(body).some((k) => k !== 'body')) return json(route, 403, { message: 'permission denied for table comments' });
        Object.assign(c, { body: body.body, edited_at: now() });
      }
      if (c && req.method() === 'DELETE') db.comments.splice(db.comments.indexOf(c), 1);
      return json(route, 204);
    }
    return json(route, 400, { message: `unhandled ${req.method()} ${path}` });
  }
  return { handle, db, stats };
}

// ---------------------------------------------------------------------------------
(async () => {
  execFileSync('node', ['scripts/build-manifest.mjs'], { cwd: root, stdio: 'ignore' });
  const server = spawn('node', ['scripts/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const browser = await chromium.launch();
  const external = [];
  const errors = [];

  async function newPage(context, { config } = {}) {
    if (config) {
      await context.route('**/site.config.json', async (route) => {
        const res = await route.fetch();
        const c = await res.json();
        await route.fulfill({ json: { ...c, comments: config } });
      });
    }
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    context.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith(SB) && !u.startsWith('data:')) external.push(u); });
    return page;
  }
  const readyCount = (page) => page.evaluate(() => window.__protoViewer?.readyCount ?? 0);
  async function waitReady(page, prev) {
    await page.waitForFunction((n) => (window.__protoViewer?.readyCount ?? 0) > n, prev, { timeout: 15000 });
    await page.waitForTimeout(150);
  }
  /** Full page load of a viewer URL (a hash-only goto wouldn't reload the viewer). */
  async function open(page, hash) {
    await page.goto('about:blank');
    await page.goto(`${BASE}${hash}`);
    await waitReady(page, 0);
  }
  async function frameBox(page, selector) {
    return page.frameLocator('iframe.pv-frame').locator(selector).first().boundingBox();
  }
  /** Enters comment mode, clicks at a fraction of an element, fills and posts. */
  async function addComment(page, selector, fx, fy, text) {
    await page.click('.pv-c-new');
    const b = await frameBox(page, selector);
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await page.waitForSelector('.pv-composer:not([hidden]) textarea', { timeout: 5000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(shots, 'FAILED-addComment.png') });
      throw e;
    });
    await page.fill('.pv-composer textarea', text);
    const before = await page.$$eval('.pv-thread', (t) => t.length);
    await page.click('.pv-composer [type=submit]');
    await page.waitForFunction((n) => document.querySelectorAll('.pv-thread').length > n, before);
    await page.waitForTimeout(150);
  }
  /** Pin point (its bottom-left corner) relative to an element's box, as fractions. */
  async function pinOnElement(page, n, selector) {
    const pin = await page.locator(`.pv-pin[data-id]`, { hasText: new RegExp(`^${n}$`) }).boundingBox();
    const el = await frameBox(page, selector);
    if (!pin || !el) return null;
    return { fx: (pin.x - el.x) / el.width, fy: (pin.y + pin.height - el.y) / el.height };
  }
  const threadBadges = (page) => page.$$eval('.pv-thread', (ts) => ts.map((t) => [...t.querySelectorAll('.pv-badge')].map((b) => b.dataset.kind).join(',')));

  try {
    // ============================ Part 1: this browser only ============================
    const ctx1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx1.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const p = await newPage(ctx1);
    await open(p, '#/p/order-list-bulk-actions');
    await p.click('[data-action=comments]');
    check('not set up: panel explains and links to the guide', (await p.textContent('.pv-comments')).includes('aren’t set up') && !!(await p.$('.pv-comments a[href="#/setup"]')));
    await p.screenshot({ path: path.join(shots, '1-not-set-up.png') });
    check('viewing works without comments (no pins, no errors)', (await p.$$('.pv-pin')).length === 0 && errors.length === 0);
    await p.click('[data-action=local-on]');
    await p.waitForSelector('.pv-signin');
    check('"Try in this browser" asks for a name (no password locally)', !(await p.$('.pv-signin [name=password]')));
    await p.fill('.pv-signin [name=name]', 'Maria');
    await p.click('.pv-signin [type=submit]');
    await p.waitForSelector('.pv-c-new');
    check('local comments on, signed in as the name', (await p.textContent('.pv-c-foot')).includes('only in this browser') && (await p.textContent('.pv-c-foot')).includes('Maria'));

    // Comment mode: clicks don't reach the prototype.
    await p.click('.pv-c-new');
    const sel1 = await p.frameLocator('iframe.pv-frame').locator('#toolbar-count').textContent();
    const shipBtn = await frameBox(p, '[data-proto-id=bulk-mark-shipped]');
    await p.mouse.click(shipBtn.x + shipBtn.width / 2, shipBtn.y + shipBtn.height / 2);
    await p.waitForTimeout(200);
    const dialogOpened = await p.frameLocator('iframe.pv-frame').locator('vaadin-confirm-dialog[opened]').count();
    check('comment mode captures clicks (prototype button not triggered)', dialogOpened === 0 && (await p.isVisible('.pv-composer')), `toolbar still "${sel1}"`);
    const composerOn = await p.textContent('.pv-composer-on');
    check('composer names the element', composerOn.includes('bulk-mark-shipped'), composerOn.trim());
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    check('Escape cancels the draft and leaves comment mode', !(await p.isVisible('.pv-composer')) && (await p.getAttribute('.pv-c-new', 'aria-pressed')) === 'false');

    await addComment(p, '[data-proto-id=orders-grid]', 0.8, 0.3, 'Can we show the total of the selected orders?');
    check('comment posted under the signed-in name', (await p.textContent('.pv-thread')).includes('Maria'));
    check('new thread is selected and in the URL', (await p.evaluate(() => location.hash)).includes('thread='));
    check('thread badge: current', (await threadBadges(p))[0] === 'current');
    await p.screenshot({ path: path.join(shots, '1-first-comment.png') });

    // Pins stay on their element across widths.
    const atFull = await pinOnElement(p, 1, '[data-proto-id=orders-grid]');
    const sizes = {};
    for (const id of ['tablet', 'phone']) {
      await p.click('[data-role=size] .pv-menu-button');
      await p.click(`[data-role=size] [data-id=${id}]`);
      await p.waitForTimeout(300);
      sizes[id] = await pinOnElement(p, 1, '[data-proto-id=orders-grid]');
      await p.screenshot({ path: path.join(shots, `1-pin-${id}.png`) });
    }
    const near = (a, b) => a && b && Math.abs(a.fx - b.fx) < 0.02 && Math.abs(a.fy - b.fy) < 0.02;
    check('pin stays on its element at Full, Tablet and Phone', near(atFull, { fx: 0.8, fy: 0.3 }) && near(sizes.tablet, atFull) && near(sizes.phone, atFull),
      `full ${JSON.stringify(atFull)} tablet ${JSON.stringify(sizes.tablet)} phone ${JSON.stringify(sizes.phone)}`);
    await p.click('[data-role=size] .pv-menu-button');
    await p.click('[data-role=size] [data-id=full]');
    await p.waitForTimeout(200);

    // Layout changes inside the prototype: the pin is redrawn on its element.
    const before = await p.locator('.pv-pin[data-id]').first().boundingBox();
    await p.evaluate(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('main.view').style.paddingTop = '120px'; });
    await p.waitForTimeout(200);
    const after = await p.locator('.pv-pin[data-id]').first().boundingBox();
    const rel = await pinOnElement(p, 1, '[data-proto-id=orders-grid]');
    check('pin follows its element when the layout changes', after.y - before.y > 30 && near(rel, atFull), `moved ${Math.round(after.y - before.y)}px, still at ${JSON.stringify(rel)}`);
    await p.evaluate(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('main.view').style.paddingTop = ''; });

    // Reply, edit, delete.
    await p.fill('.pv-thread[aria-current] textarea[name=reply]', 'Yes, next to the count.');
    await p.click('.pv-thread[aria-current] .pv-reply [type=submit]');
    await p.waitForFunction(() => document.querySelectorAll('.pv-thread[aria-current] .pv-comment').length === 2);
    check('reply added', true);
    await p.click('.pv-thread[aria-current] .pv-comment:nth-of-type(2) [data-action=edit], .pv-thread[aria-current] .pv-comment >> nth=1 >> [data-action=edit]').catch(async () => {
      await p.locator('.pv-thread[aria-current] .pv-comment').nth(1).locator('[data-action=edit]').click();
    });
    await p.locator('.pv-thread[aria-current] .pv-comment').nth(1).locator('textarea').fill('Yes, right next to the count.');
    await p.locator('.pv-thread[aria-current] .pv-comment').nth(1).locator('[data-action=save-edit]').click();
    await p.waitForTimeout(150);
    const edited = await p.locator('.pv-thread[aria-current] .pv-comment').nth(1).textContent();
    check('own comment edited (marked edited)', edited.includes('right next to') && edited.includes('edited'));
    p.once('dialog', (d) => d.accept());
    await p.locator('.pv-thread[aria-current] .pv-comment').nth(1).locator('[data-action=delete]').click();
    await p.waitForFunction(() => document.querySelectorAll('.pv-thread[aria-current] .pv-comment').length === 1);
    check('own comment deleted', true);

    // Variant b: a thread on the selection footer.
    let n = await readyCount(p);
    await p.click('[data-role=variant] button[data-id=b]');
    await waitReady(p, n);
    check('threads of another variant are listed but not pinned', (await p.$$('.pv-pin[data-id]')).length === 0 && (await p.textContent('.pv-thread')).includes('Variant: Toolbar actions'));
    await addComment(p, '[data-proto-id=selection-footer]', 0.5, 0.5, 'The footer covers the last row on small screens.');
    check('thread in variant b gets pin 2', (await p.$$eval('.pv-pin[data-id]', (ps) => ps.map((x) => x.textContent))).join() === '2');
    // Clicking the variant-a thread switches the view to variant a.
    n = await readyCount(p);
    await p.locator('.pv-thread').filter({ hasText: 'Variant: Toolbar actions' }).locator('.pv-thread-head').click();
    await waitReady(p, n);
    check('clicking a thread moves the view to its variant', (await p.evaluate(() => location.hash)).includes('variant=a') && (await p.$$eval('.pv-pin[data-id]', (ps) => ps.map((x) => x.textContent))).join() === '1');

    // Resolve / reopen; counts.
    const countBefore = await p.textContent('.pv-comments-button .pv-count');
    await p.click('.pv-thread[aria-current] [data-action=resolve]');
    await p.waitForTimeout(200);
    check('resolve moves the thread under Resolved and hides its pin', (await p.textContent('.pv-c-resolved summary')).includes('Resolved (1)') && (await p.$$('.pv-pin[data-id]')).length === 0);
    check('open count updates (header and sidebar)', countBefore === '2' && (await p.textContent('.pv-comments-button .pv-count')) === '1' && (await p.textContent('a.pv-item[data-slug=order-list-bulk-actions] .pv-item-comments')).trim() === '1');
    await p.click('.pv-c-resolved summary');
    await p.locator('.pv-c-resolved .pv-thread-head').click();
    await p.waitForTimeout(200);
    await p.click('.pv-thread[aria-current] [data-action=reopen]');
    await p.waitForTimeout(200);
    check('reopen brings it back', !(await p.$('.pv-c-resolved')) && (await p.textContent('.pv-comments-button .pv-count')) === '2');

    // Deep link to a thread restores panel, selection, variant and pin.
    await p.locator('.pv-thread').filter({ hasText: 'footer covers' }).locator('.pv-thread-head').click();
    await p.waitForTimeout(800);
    const link = p.url();
    const p2 = await newPage(ctx1);
    await p2.goto(link);
    await waitReady(p2, 0);
    await p2.waitForSelector('.pv-thread[aria-current]');
    check('deep link with thread= opens the panel on that thread', (await p2.textContent('.pv-thread[aria-current]')).includes('footer covers') && (await p2.$('.pv-pin[aria-current]')) !== null);
    await p2.screenshot({ path: path.join(shots, '1-deep-link-thread.png') });
    await p2.close();

    // Hidden element (other tab) and outdated element (removed from the page).
    await open(p, '#/p/customer-profile-edit');
    await p.frameLocator('iframe.pv-frame').locator('#addresses-tab').click();
    await p.waitForTimeout(300);
    await addComment(p, '[data-proto-id=address-list]', 0.3, 0.3, 'Primary address should come first.');
    await p.frameLocator('iframe.pv-frame').locator('#details-tab').click();
    await p.waitForTimeout(300);
    check('element hidden (other tab): "Not visible here", no pin', (await threadBadges(p))[0] === 'current,hidden' && (await p.$$('.pv-pin[data-id]')).length === 0);
    await addComment(p, '[data-proto-id=internal-notes]', 0.5, 0.5, 'Notes should be private to staff.');
    await ctx1.route('**/prototypes/customer-profile-edit/', async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace('data-proto-id="internal-notes"', '');
      await route.fulfill({ response: res, body: html });
    });
    await open(p, '#/p/customer-profile-edit');
    await p.waitForSelector('.pv-thread');
    await p.waitForTimeout(300);
    const badgesAfterRemoval = await threadBadges(p);
    check('element removed: thread marked outdated and not pinned', badgesAfterRemoval.includes('outdated') && (await p.$$('.pv-pin[data-id]')).length === 0, badgesAfterRemoval.join(' | '));
    await p.screenshot({ path: path.join(shots, '1-outdated.png') });
    await ctx1.unroute('**/prototypes/customer-profile-edit/');

    // Earlier version: the manifest says the prototype changed since the comment.
    await ctx1.route('**/manifest.json', async (route) => {
      const res = await route.fetch();
      const m = await res.json();
      m.prototypes.find((x) => x.slug === 'order-list-bulk-actions').version = 'f'.repeat(40);
      await route.fulfill({ json: m });
    });
    await open(p, '#/p/order-list-bulk-actions?variant=b');
    await p.waitForSelector('.pv-thread .pv-badge');
    check('comment on an older commit: "Earlier version"', (await threadBadges(p)).includes('earlier'));
    await ctx1.unroute('**/manifest.json');
    await ctx1.close();

    // ============================ Part 2: mock Supabase ============================
    const mock = createMockSupabase();
    const sbConfig = { backend: 'supabase', project: 'acme', supabase: { url: SB, publishableKey: 'sb_publishable_test' } };
    const contexts = [];
    async function sbPage(hash = '#/p/order-list-bulk-actions') {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await ctx.route(`${SB}/**`, (r) => mock.handle(r));
      contexts.push(ctx);
      const page = await newPage(ctx, { config: sbConfig });
      await page.goto(`${BASE}${hash}`);
      await waitReady(page, 0);
      return page;
    }
    async function signIn(page, password, name) {
      await page.evaluate(() => document.querySelector('.pv-signin .pv-c-error')?.remove());
      await page.fill('.pv-signin [name=password]', password);
      await page.fill('.pv-signin [name=name]', name);
      await page.click('.pv-signin [type=submit]');
      await page.waitForFunction(() => document.querySelector('.pv-c-new') || document.querySelector('.pv-signin .pv-c-error'));
    }

    const A = await sbPage();
    await A.click('[data-action=comments]');
    await A.waitForSelector('.pv-signin');
    check('not signed in: sign-in form with password + name, project named', !!(await A.$('.pv-signin [name=password]')) && (await A.textContent('.pv-comments')).includes('ACME Corp'));
    check('not signed in: no comment data requested', !Object.keys(mock.stats.threadReads).length);
    await A.screenshot({ path: path.join(shots, '2-sign-in.png') });
    await signIn(A, 'wrong', 'Anna');
    check('wrong password is refused', (await A.textContent('.pv-signin .pv-c-error')).includes('isn’t right'));
    await signIn(A, PASSWORD, 'Anna');
    check('right password signs in', (await A.textContent('.pv-c-foot')).includes('Signed in as Anna') && (await A.textContent('.pv-c-foot')).includes('ACME Corp'));
    await addComment(A, '[data-proto-id=orders-grid]', 0.5, 0.2, 'Shared comment from browser A');
    await A.click('[data-action=copy]');
    check('Copy link contains no secret', !(await A.evaluate(() => navigator.clipboard.readText())).includes(PASSWORD));
    const errorsBeforeSpoof = errors.length;
    const spoof = await A.evaluate(async ({ SB }) => {
      const s = JSON.parse(localStorage.getItem(`proto-viewer:supabase-session:${SB}`));
      const res = await fetch(`${SB}/rest/v1/comments`, { method: 'POST', headers: { apikey: 'sb_publishable_test', Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ thread_id: 'x', body: 'hi', author_name: 'Mallory' }) });
      return res.status;
    }, { SB });
    await A.waitForTimeout(100);
    errors.splice(errorsBeforeSpoof); // the browser logs the expected 403
    check('author name can’t be sent by the browser (column not writable)', spoof === 403);

    const B = await sbPage();
    await B.click('[data-action=comments]');
    await B.waitForSelector('.pv-signin');
    await signIn(B, PASSWORD, 'Ben');
    await B.waitForSelector('.pv-thread');
    check('browser B (signed in) sees browser A’s comment', (await B.textContent('.pv-thread')).includes('Shared comment from browser A') && (await B.textContent('.pv-thread')).includes('Anna'));
    if (!(await B.$('.pv-thread[aria-current]'))) await B.locator('.pv-thread-head').first().click();
    await B.waitForSelector('.pv-thread[aria-current]');
    check('B can’t edit A’s comment (no Edit button)', (await B.$$('.pv-thread[aria-current] [data-action=edit]')).length === 0);
    await B.fill('.pv-thread[aria-current] textarea[name=reply]', 'Reply from browser B');
    await B.click('.pv-thread[aria-current] .pv-reply [type=submit]');
    await B.waitForFunction(() => document.querySelectorAll('.pv-thread[aria-current] .pv-comment').length === 2);
    await A.reload();
    await waitReady(A, 0);
    await A.waitForSelector('.pv-thread');
    check('A stays signed in after a reload', (await A.textContent('.pv-c-foot')).includes('Signed in as Anna'));
    if (!(await A.$('.pv-thread[aria-current]'))) await A.locator('.pv-thread-head').first().click();
    await A.waitForSelector('.pv-thread[aria-current] .pv-comment >> nth=1');
    check('after a refresh A sees B’s reply, under B’s name', (await A.textContent('.pv-thread[aria-current]')).includes('Reply from browser B') && (await A.textContent('.pv-thread[aria-current]')).includes('Ben'));
    await A.screenshot({ path: path.join(shots, '2-supabase-two-browsers.png') });

    // Change name: applies to new comments.
    await A.click('[data-action=rename]');
    await A.fill('.pv-rename [name=name]', 'Anna K.');
    await A.click('.pv-rename [type=submit]');
    await A.waitForFunction(() => document.querySelector('.pv-c-foot').textContent.includes('Anna K.'));
    await A.fill('.pv-thread[aria-current] textarea[name=reply]', 'Renamed reply');
    await A.click('.pv-thread[aria-current] .pv-reply [type=submit]');
    await A.waitForFunction(() => document.querySelectorAll('.pv-thread[aria-current] .pv-comment').length === 3);
    check('changed name is used for new comments', (await A.locator('.pv-thread[aria-current] .pv-comment').nth(2).textContent()).includes('Anna K.'));

    // A visitor who never signs in, and one who only knows another project's password.
    const C = await sbPage();
    await C.click('[data-action=comments]');
    await C.waitForSelector('.pv-signin');
    check('visitor without the password sees no comments and no pins', (await C.$$('.pv-thread')).length === 0 && (await C.$$('.pv-pin')).length === 0);
    await signIn(C, 'other-pw', 'Carol');
    check('another project’s password doesn’t open this project', (await C.textContent('.pv-signin .pv-c-error')).includes('isn’t right'));
    for (let i = 0; i < 4; i++) await signIn(C, `guess-${i}`, 'Carol');
    await signIn(C, PASSWORD, 'Carol');
    check('after 5 wrong passwords: locked for a while, even with the right one', (await C.textContent('.pv-signin .pv-c-error')).includes('Too many'));

    // Sign out, and a password change signing everyone out.
    B.once('dialog', (d) => d.accept());
    await B.click('[data-action=sign-out]');
    await B.waitForSelector('.pv-signin');
    check('sign out hides comments again', (await B.$$('.pv-thread')).length === 0);
    const acme = mock.db.projects.find((x) => x.slug === 'acme');
    acme.password = 'new-acme-pw';
    acme.version++;
    await A.reload();
    await waitReady(A, 0);
    await A.waitForSelector('.pv-signin');
    check('password change signs everyone out', (await A.$$('.pv-thread')).length === 0);
    await signIn(A, 'new-acme-pw', 'Anna');
    await A.waitForSelector('.pv-thread');
    check('the new password lets people back in, comments intact', (await A.textContent('.pv-thread')).includes('Shared comment from browser A'));

    // Setup guide: password SQL and connection check (against the mock).
    await A.goto('about:blank');
    await A.goto(`${BASE}#/setup`);
    await A.waitForSelector('.pv-setup-doc');
    check('setup guide renders with the schema', (await A.textContent('#pv-schema')).includes('create or replace function public.join_project'));
    await A.fill('#pv-proj-slug', 'acme');
    await A.click('#pv-gen');
    const generated = await A.inputValue('#pv-proj-password');
    const insertSql = await A.textContent('#pv-insert');
    check('generated password is strong and goes into a bcrypt insert', /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(generated) && insertSql.includes(`extensions.crypt('${generated}', extensions.gen_salt('bf', 10))`), generated);
    check('site.config.json snippet includes the project id', (await A.textContent('#pv-config')).includes('"project": "acme"'));
    await A.fill('#pv-sb-password', 'new-acme-pw');
    await A.click('#pv-test');
    await A.waitForFunction(() => document.querySelectorAll('#pv-checks li').length >= 4);
    const checks = await A.$$eval('#pv-checks li', (l) => l.map((x) => x.dataset.ok));
    check('connection check passes against the mock (schema, project, password, read)', checks.every((x) => x === 'true'), checks.join());
    await A.fill('#pv-proj-slug', 'nope');
    await A.click('#pv-test');
    await A.waitForFunction(() => document.querySelector('#pv-checks').textContent.includes('No project'));
    check('connection check reports an unknown project id', true);
    await A.fill('#pv-sb-key', 'sb_secret_xyz');
    await A.click('#pv-test');
    check('connection check refuses a secret key', (await A.textContent('#pv-checks')).includes('secret key'));
    await A.screenshot({ path: path.join(shots, '3-setup.png'), fullPage: true });
    for (const c of contexts) await c.close();

    // ============================ Part 3: comments off ============================
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const off = await newPage(ctx3, { config: { backend: 'none' } });
    await open(off, '#/p/order-list-bulk-actions');
    await off.keyboard.press('c');
    await off.waitForTimeout(200);
    check('"backend": "none": no comment button, panel or pins', !(await off.$('.pv-comments-button')) && !(await off.$('.pv-comments')) && !(await off.$('.pv-pins')));
    await ctx3.close();

    check('no requests to other hosts', external.length === 0, external.slice(0, 3).join(', '));
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
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
