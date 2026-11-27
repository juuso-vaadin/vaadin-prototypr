/**
 * The comments setup guide, shown in the viewer at #/setup.
 *
 * Everything an admin needs to connect comment storage, inside the app: the steps,
 * the schema to copy, the SQL to add a customer with a generated comment password,
 * the site.config.json snippet, and a connection check that runs against the values
 * typed here, before anything is committed.
 */
import { BACKENDS } from './comments/backends/index.js';
import { copyText, escapeHtml } from './util.js';

/** A strong password that is easy to type: 4 groups of 4 (≈80 bits). */
function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(16));
  const chars = [...a].map((n) => alphabet[n % alphabet.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

export function createSetupPage(host, { siteConfig }) {
  host.classList.add('pv-setup');
  const cfg = siteConfig.comments ?? {};
  const sb = cfg.supabase ?? {};
  const backendKind = cfg.backend || 'supabase';
  const configured = !!BACKENDS[backendKind]?.isConfigured(cfg);
  const customer = siteConfig.customer || '';
  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'customer';
  const siteUrl = `${location.origin}${location.pathname}`;

  const stateLine = cfg.backend === 'none'
    ? 'Comments are <strong>turned off</strong> for this site (<code>"backend": "none"</code>).'
    : configured
      ? `Comments are <strong>connected</strong> to ${escapeHtml(backendKind === 'supabase' ? 'Supabase' : backendKind)} (project <code>${escapeHtml(cfg.project)}</code>).`
      : 'Comments are <strong>not set up</strong>. The site works without them; follow the steps below to add them.';

  host.innerHTML = `
    <article class="pv-setup-doc">
      <p class="pv-setup-kicker">Site setup</p>
      <h1>Set up comments</h1>
      <p class="pv-setup-lead">Comments are optional. Without them the viewer works as before. With them, people who know this site's comment password can sign in with their name and pin comments on prototypes, Figma-style.</p>
      <p class="pv-setup-status">${stateLine}</p>

      <h2>How it works</h2>
      <ul>
        <li>Comments are stored in a <strong>Supabase</strong> project (Postgres with a web API). One Supabase project can serve all customer sites; each customer site is a <em>project</em> row with its own <strong>comment password</strong>.</li>
        <li>Anyone with the site address can browse the prototypes. Seeing and adding comments needs signing in once per browser with the comment password and a name. The name is shown with every comment.</li>
        <li>The database stores only a bcrypt hash of the password, checks it itself, and limits wrong attempts (5 per person and 50 per project in 15 minutes). Changing the password signs everyone out.</li>
        <li>The prototype pages themselves stay public to anyone with their URL (GitHub Pages). The password protects the comments.</li>
      </ul>

      <h2>1. Create the Supabase project <span class="pv-setup-once">once for all customers</span></h2>
      <ol>
        <li>Sign in at <strong>supabase.com</strong> and create a project. Choose an <strong>EU region</strong>.</li>
        <li>Under <strong>Authentication → Sign In / Providers</strong>, turn on <strong>Allow anonymous sign-ins</strong>. Consider turning on CAPTCHA protection (Authentication → Attack Protection) if links are shared widely.</li>
        <li>Open the <strong>SQL editor</strong>, paste the schema below and run it. Running it again later is safe; do so after updating this repository's <code>supabase/schema.sql</code>.</li>
      </ol>
      <div class="pv-setup-code">
        <div class="pv-setup-code-head"><span>supabase/schema.sql</span><button type="button" class="pv-button" data-copy="schema">Copy</button></div>
        <pre id="pv-schema">Loading…</pre>
      </div>

      <h2>2. Add this customer <span class="pv-setup-once">once per customer site</span></h2>
      <p>Pick the project id and name, generate a password, and run the SQL. The password appears in the SQL (the database hashes it with bcrypt and keeps only the hash), so store it in your password manager right away.</p>
      <div class="pv-setup-form">
        <label>Project id <input id="pv-proj-slug" value="${escapeHtml(cfg.project || slugify(customer))}" pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
        <label>Name <input id="pv-proj-name" value="${escapeHtml(customer)}" /></label>
        <label>Comment password <input id="pv-proj-password" autocomplete="off" spellcheck="false" /></label>
        <button type="button" class="pv-button" id="pv-gen">Generate password</button>
      </div>
      <div class="pv-setup-code"><div class="pv-setup-code-head"><span>SQL: add the customer</span><button type="button" class="pv-button" data-copy="insert">Copy</button></div><pre id="pv-insert"></pre></div>
      <p class="pv-setup-small">Changing the password later (signs everyone out of this project):</p>
      <div class="pv-setup-code"><div class="pv-setup-code-head"><span>SQL: change the password</span><button type="button" class="pv-button" data-copy="rotate">Copy</button></div><pre id="pv-rotate"></pre></div>

      <h2>3. Connect this site</h2>
      <p>In Supabase, open <strong>Project Settings → API keys</strong> (or the <strong>Connect</strong> dialog) and copy the <strong>project URL</strong> and the <strong>publishable key</strong> (<code>sb_publishable_…</code>, or the legacy <em>anon</em> key). Both are safe to publish; the access rules do the protecting. Never use the secret or <em>service_role</em> key here.</p>
      <div class="pv-setup-form">
        <label>Project URL <input id="pv-sb-url" placeholder="https://xxxx.supabase.co" value="${escapeHtml(sb.url ?? '')}" /></label>
        <label>Publishable key <input id="pv-sb-key" placeholder="sb_publishable_…" value="${escapeHtml(sb.publishableKey ?? '')}" /></label>
        <label><span>Comment password <span class="pv-optional">(optional, also tests signing in)</span></span><input id="pv-sb-password" type="password" autocomplete="off" /></label>
        <button type="button" class="pv-button" id="pv-test">Check connection</button>
      </div>
      <ul class="pv-checks" id="pv-checks" hidden></ul>
      <p>Then put the project id, URL and key into <code>site.config.json</code> in the repository, commit and push. The site redeploys in a minute or two.</p>
      <div class="pv-setup-code"><div class="pv-setup-code-head"><span>site.config.json</span><button type="button" class="pv-button" data-copy="config">Copy</button></div><pre id="pv-config"></pre></div>

      <h2>4. Share</h2>
      <p>Send people the site address, and the comment password through a separate channel (not in the same email or chat message as the link). They open <strong>Comments</strong>, sign in with the password and their name, and stay signed in in that browser. Anyone without the password can still browse the prototypes but sees no comments.</p>

      <h2>Turning comments off</h2>
      <p>Set <code>"backend": "none"</code> under <code>comments</code> in <code>site.config.json</code>. All comment UI disappears; nothing else changes.</p>

      <h2>Using another database</h2>
      <p>The viewer talks to comment storage through a small interface in <code>viewer/comments/backends/</code>; <code>supabase.js</code> is one implementation and <code>local.js</code> (this browser only) another. To use something else, add a file there that implements the methods listed in <code>backends/index.js</code> (connect, list threads, open counts, create thread, add / edit / delete comment, set status), register it in <code>BACKENDS</code>, and set <code>"backend": "&lt;name&gt;"</code> plus its settings in <code>site.config.json</code>. Whatever the database, it must keep comments readable and writable only for signed-in members of the customer's project, take author names from the membership, let authors edit and delete only their own comments, and let members resolve and reopen threads. GitHub sign-in (an allow-list of GitHub users per project) is the planned next way to become a member. <code>supabase/schema.sql</code> shows the data model and rules.</p>

      <h2>Troubleshooting</h2>
      <ul>
        <li><strong>“Anonymous sign-ins are disabled”</strong>: step 1.2.</li>
        <li><strong>“The comment tables are missing”</strong>: run the schema (step 1.3) in the right project.</li>
        <li><strong>“Comments aren’t available”</strong>: <code>comments.project</code> in <code>site.config.json</code> doesn't match a project id from step 2 (or step 2 ran in another Supabase project).</li>
        <li><strong>“Too many wrong passwords”</strong>: wait 15 minutes. If it keeps happening, someone may be guessing; change the password (step 2).</li>
        <li><strong>Everyone was signed out</strong>: the password was changed. Share the new one.</li>
      </ul>
    </article>`;

  const $ = (s) => host.querySelector(s);
  const values = { schema: '', insert: '', rotate: '', config: '' };

  fetch('supabase/schema.sql', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((t) => { values.schema = t; $('#pv-schema').textContent = t; })
    .catch(() => { $('#pv-schema').textContent = 'Could not load supabase/schema.sql from this site. Copy it from the repository instead.'; });

  function renderConfig() {
    const conf = {
      ...siteConfig,
      comments: { backend: 'supabase', project: $('#pv-proj-slug').value.trim(), supabase: { url: $('#pv-sb-url').value.trim(), publishableKey: $('#pv-sb-key').value.trim() } },
    };
    values.config = `${JSON.stringify(conf, null, 2)}\n`;
    $('#pv-config').textContent = values.config;
  }
  renderConfig();
  $('#pv-sb-url').addEventListener('input', renderConfig);
  $('#pv-sb-key').addEventListener('input', renderConfig);

  function renderSql() {
    const q = (v) => v.replace(/'/g, "''");
    const slug = $('#pv-proj-slug').value.trim() || 'customer';
    const name = $('#pv-proj-name').value.trim() || slug;
    const pw = $('#pv-proj-password').value || '<comment password>';
    values.insert = `insert into public.projects (slug, name, password_hash)\nvalues ('${q(slug)}', '${q(name)}', extensions.crypt('${q(pw)}', extensions.gen_salt('bf', 10)));`;
    values.rotate = `update public.projects\n   set password_hash = extensions.crypt('<new password>', extensions.gen_salt('bf', 10)),\n       password_version = password_version + 1\n where slug = '${q(slug)}';`;
    $('#pv-insert').textContent = values.insert;
    $('#pv-rotate').textContent = values.rotate;
    renderConfig();
  }
  for (const id of ['#pv-proj-slug', '#pv-proj-name', '#pv-proj-password']) $(id).addEventListener('input', renderSql);
  $('#pv-gen').addEventListener('click', () => {
    $('#pv-proj-password').value = generatePassword();
    $('#pv-sb-password').value = $('#pv-proj-password').value;
    renderSql();
  });
  renderSql();

  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const ok = await copyText(values[b.dataset.copy] ?? '');
    b.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { b.textContent = 'Copy'; }, 1500);
  });

  $('#pv-test').addEventListener('click', async () => {
    const list = $('#pv-checks');
    const url = $('#pv-sb-url').value.trim();
    const key = $('#pv-sb-key').value.trim();
    const project = $('#pv-proj-slug').value.trim();
    const password = $('#pv-sb-password').value;
    const rows = [];
    const show = () => {
      list.hidden = false;
      list.innerHTML = rows.map((r) => `<li data-ok="${r.ok}"><span aria-hidden="true">${r.ok ? '✓' : '✗'}</span> ${r.text}</li>`).join('');
    };
    const add = (ok, text) => { rows.push({ ok, text }); show(); };
    list.hidden = false;
    list.innerHTML = '<li><span aria-hidden="true">…</span> Checking…</li>';
    if (!/^https:\/\/.+/.test(url) || !key) return (rows.length = 0, add(false, 'Enter the project URL (https://…) and the publishable key.'));
    if (/service_role|sb_secret_/.test(key)) return (rows.length = 0, add(false, 'That looks like a secret key. Use the publishable (anon) key; secret keys must never be in a website.'));
    if (!project) return (rows.length = 0, add(false, 'Enter the project id (step 2).'));
    const backend = BACKENDS.supabase.create({ project, supabase: { url, publishableKey: key } });
    const result = await backend.connect();
    if (result.status === 'error') return add(false, escapeHtml(result.message));
    add(true, 'Reached Supabase, anonymous sign-in works and the comment schema is installed.');
    if (result.status === 'unknown-project') return add(false, `No project <code>${escapeHtml(project)}</code> in <code>public.projects</code>. Run the SQL from step 2 in this Supabase project.`);
    add(true, `Project <strong>${escapeHtml(result.project.name)}</strong> exists.`);
    if (!password) return add(true, 'Enter the comment password to also test signing in.');
    const r = await backend.signIn({ password, name: 'Setup check' }).catch((e) => ({ ok: false, reason: e.message }));
    if (!r.ok) return add(false, r.reason === 'wrong-password' ? 'The comment password is wrong.' : r.reason === 'too-many-attempts' ? 'Too many wrong passwords; wait 15 minutes.' : escapeHtml(r.reason));
    add(true, 'The comment password works. (This browser is now signed in as “Setup check”; sign out in the comments panel if you like.)');
    try {
      await backend.listThreads('__setup_check__');
      add(true, 'Comments can be read. Put the values into site.config.json (below) and push.');
    } catch (err) {
      add(false, escapeHtml(err.message));
    }
  });

  return {};
}
