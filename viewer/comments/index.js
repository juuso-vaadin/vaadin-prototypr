/**
 * Comments (SPEC.md §6): the panel, pins, comment mode and the composer.
 *
 * Comments are optional. Depending on site.config.json → comments.backend:
 *   "none"                  no comment UI at all
 *   "supabase" (configured) shared comments for everyone with the share link
 *   not configured yet      the panel explains this and links to the setup guide
 *                           (#/setup); "Try in this browser" switches to the
 *                           local backend (saved only in this browser)
 *
 * Viewing prototypes needs nothing. Seeing and adding comments needs signing in:
 * with Supabase, the site's comment password plus a display name (SPEC.md §6.2).
 */
import { BACKENDS } from './backends/index.js';
import { createOverlay } from './overlay.js';
import { anchorLabel, resolveAnchor } from './anchor.js';
import { icons } from '../icons.js';
import { escapeHtml, prefs, relativeTime, siteStorage } from '../util.js';

const STATUS_TEXT = {
  'not-configured': {
    title: 'Comments aren’t set up yet',
    body: 'This site can show Figma-style comments once a database is connected. Viewing prototypes works without it.',
  },
  'signed-out': {
    title: 'Sign in to see and add comments',
    body: 'Comments on these prototypes are shared with the project team. Ask your contact for the comment password.',
  },
  'unknown-project': {
    title: 'Comments aren’t available',
    body: 'This site’s comment project wasn’t found in the database. Check <code>comments.project</code> in site.config.json against the setup guide.',
  },
  error: { title: 'Comments couldn’t be loaded', body: '' },
  connecting: { title: 'Loading comments…', body: '' },
};

export function createComments({ app, header, stage, store, siteConfig, onCounts }) {
  const cfg = siteConfig.comments ?? {};
  const disabled = cfg.backend === 'none';
  if (disabled) {
    return { enabled: false, view() {}, documentReady() {}, documentGone() {}, layout() {}, refresh() {} };
  }

  const kind = cfg.backend || 'supabase';
  const configured = !!BACKENDS[kind]?.isConfigured(cfg);
  let me = null; // { name, email } of the signed-in commenter
  let signInError = '';
  let renaming = false;
  let backend = null;
  let status = 'connecting';
  let message = '';
  let project = null;

  let threads = [];
  let loadedSlug = null;
  let counts = {};
  let current = { state: null, view: null }; // last render
  let panelOpen = prefs.get('comments-panel', false);
  let commentMode = false;
  let draft = null; // { anchor, x, y }
  let editing = null; // comment id being edited
  const replyDrafts = new Map();
  let resolution = new Map(); // thread id → resolveAnchor result
  let resolutionSig = '';
  let pendingScroll = null;
  let errorText = '';
  let lastPanelHtml = '';

  // ---- DOM ---------------------------------------------------------------------
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pv-button pv-comments-button';
  button.dataset.action = 'comments';
  button.title = 'Comments (C to add one)';
  header.querySelector('[data-role=comments]').replaceWith(button);

  const panel = document.createElement('aside');
  panel.className = 'pv-comments';
  panel.setAttribute('aria-label', 'Comments');
  app.append(panel);

  const composer = document.createElement('form');
  composer.className = 'pv-composer';
  composer.hidden = true;
  stage.canvas.append(composer);

  const overlay = createOverlay(stage, {
    onPinClick: (id) => selectThread(id, { navigate: false }),
    onPick: ({ anchor, x, y }) => {
      draft = { anchor, x, y };
      renderComposer();
      recompute();
    },
    onChange: () => recompute(),
    onKey: (e) => onKey(e),
  });

  button.addEventListener('click', () => setPanel(!panelOpen));
  document.addEventListener('keydown', onKey);
  window.addEventListener('focus', () => refresh({ quiet: true }));

  // ---- connection --------------------------------------------------------------
  async function connect() {
    const useLocal = !configured && siteStorage.get('comments-local', false);
    if (!configured && !useLocal) {
      backend = null;
      status = 'not-configured';
      renderAll();
      return;
    }
    backend = BACKENDS[configured ? kind : 'local'].create(cfg);
    status = 'connecting';
    renderAll();
    const result = await backend.connect();
    status = result.status;
    project = result.project ?? null;
    me = result.me ?? null;
    message = result.message ?? '';
    if (status === 'ready') {
      loadedSlug = null;
      await Promise.all([loadThreads(), loadCounts()]);
    }
    renderAll();
  }

  async function loadThreads() {
    const slug = current.state?.slug;
    if (status !== 'ready' || !slug) return;
    try {
      const list = await backend.listThreads(slug);
      if (current.state?.slug !== slug) return;
      threads = list;
      loadedSlug = slug;
      errorText = '';
    } catch (e) {
      errorText = e.message;
    }
    renderAll();
  }

  async function loadCounts() {
    if (status !== 'ready') return;
    try {
      counts = await backend.openCounts();
      onCounts?.(counts);
      renderButton();
    } catch {
      /* counts are a nicety */
    }
  }

  let lastRefresh = 0;
  async function refresh({ quiet = false } = {}) {
    if (status !== 'ready' || (quiet && Date.now() - lastRefresh < 5000)) return;
    lastRefresh = Date.now();
    await Promise.all([loadThreads(), loadCounts()]);
  }

  // ---- derived data ------------------------------------------------------------
  const strip = (v) => (v ?? '').replace(/\+dirty$/, '');
  const shown = () => threads.filter((t) => t.comments.length).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const numbers = () => new Map(shown().map((t, i) => [t.id, i + 1]));
  const selectedId = () => current.state?.extra?.thread ?? null;
  const author = () => prefs.get('author', { name: '', email: '' });

  function inCurrentView(t) {
    const v = current.view;
    return v?.proto && (t.variant ?? null) === (v.variant ?? null) && (t.snapshot ?? null) === (v.snapshot ?? null);
  }

  /** current | earlier version | outdated (§6.1); null while unknown or in another variant. */
  function badge(t) {
    if (!inCurrentView(t)) return null;
    const r = resolution.get(t.id);
    if (!r) return null;
    if (r.status === 'missing') return { kind: 'outdated', label: 'Outdated', title: 'The element this comment was on no longer exists.' };
    const isCurrent = t.snapshot || strip(t.versionSha) === strip(current.view.proto.version);
    return isCurrent
      ? { kind: 'current', label: 'Current', title: 'Made on the current version.', hidden: r.status === 'hidden' }
      : { kind: 'earlier', label: 'Earlier version', title: 'Made on an earlier version; the element still exists.', hidden: r.status === 'hidden' };
  }

  // ---- pins --------------------------------------------------------------------
  function recompute() {
    const doc = overlay.doc;
    const next = new Map();
    if (doc && status === 'ready') {
      for (const t of shown()) if (inCurrentView(t)) next.set(t.id, resolveAnchor(t.anchor, doc));
    }
    resolution = next;
    const sig = [...next].map(([id, r]) => `${id}:${r.status}`).join('|');
    if (sig !== resolutionSig) {
      resolutionSig = sig;
      renderPanel();
    }
    if (pendingScroll && next.get(pendingScroll)?.element) {
      const el = next.get(pendingScroll).element;
      pendingScroll = null;
      const r = el.getBoundingClientRect();
      const win = doc.defaultView;
      if (r.bottom < 0 || r.top > win.innerHeight || r.right < 0 || r.left > win.innerWidth) el.scrollIntoView({ block: 'center', inline: 'center' });
    }
    if (!panelOpen && !commentMode) {
      overlay.setPins([]);
      return;
    }
    const nums = numbers();
    const sel = selectedId();
    const pins = [];
    for (const t of shown()) {
      const r = resolution.get(t.id);
      if (r?.status !== 'visible') continue;
      if (t.status === 'resolved' && t.id !== sel) continue;
      pins.push({ id: t.id, n: nums.get(t.id), x: r.x, y: r.y, selected: t.id === sel, resolved: t.status === 'resolved' });
    }
    let draftPos = null;
    if (draft && doc) {
      const r = resolveAnchor(draft.anchor, doc);
      draftPos = r.status === 'visible' ? { x: r.x, y: r.y } : { x: draft.x, y: draft.y };
      positionComposer(draftPos);
    }
    overlay.setPins(pins, draftPos);
  }

  // ---- actions -----------------------------------------------------------------
  function setPanel(open) {
    panelOpen = open;
    prefs.set('comments-panel', open);
    if (!open) setCommentMode(false);
    if (open) refresh({ quiet: true });
    renderAll();
  }

  function setCommentMode(on) {
    if (on && status !== 'ready') {
      setPanel(true);
      return;
    }
    commentMode = on;
    if (!on) {
      draft = null;
      renderComposer();
    }
    overlay.setMode(on);
    if (on && !panelOpen) {
      panelOpen = true;
      prefs.set('comments-panel', true);
    }
    renderAll();
  }

  function selectThread(id, { navigate = true } = {}) {
    const s = current.state;
    const t = threads.find((x) => x.id === id);
    if (!t || !s) return;
    if (!panelOpen) setPanel(true);
    const extra = { ...s.extra, thread: id };
    pendingScroll = id;
    if (navigate) {
      const patch = {
        variant: t.variant ?? null,
        snapshot: t.snapshot ?? null,
        width: t.viewport?.width ?? null,
        scheme: t.theme === 'dark' ? 'dark' : 'light',
        extra,
      };
      const changesView = patch.variant !== (current.view.variant ?? null) || patch.snapshot !== (current.view.snapshot ?? null) || patch.width !== s.width || patch.scheme !== s.scheme;
      store.set(changesView ? patch : { extra }, { replace: !changesView });
    } else {
      store.set({ extra }, { replace: true });
    }
  }

  function deselect() {
    const { thread, ...extra } = current.state?.extra ?? {};
    if (thread) store.set({ extra }, { replace: true });
  }

  async function act(fn) {
    try {
      errorText = '';
      await fn();
    } catch (e) {
      errorText = e.message || String(e);
      renderPanel();
    }
  }

  async function postDraft() {
    const text = composer.querySelector('textarea').value.trim();
    if (!text) return composer.querySelector('textarea').focus();
    const s = current.state;
    const v = current.view;
    const win = overlay.doc?.defaultView;
    composer.querySelector('[type=submit]').disabled = true;
    await act(async () => {
      const t = await backend.createThread(
        {
          prototypeSlug: v.proto.slug,
          variant: v.variant ?? null,
          snapshot: v.snapshot ?? null,
          versionSha: v.proto.version ?? null,
          anchor: draft.anchor,
          viewport: { width: s.width, frameWidth: overlay.layoutInfo.width, scrollY: Math.round(win?.scrollY ?? 0) },
          theme: s.scheme,
        },
        text,
      );
      threads.push(t);
      draft = null;
      commentMode = false;
      overlay.setMode(false);
      renderComposer();
      store.set({ extra: { ...s.extra, thread: t.id } }, { replace: true });
      loadCounts();
    });
    composer.querySelector('[type=submit]') && (composer.querySelector('[type=submit]').disabled = false);
    renderAll();
  }

  function onKey(e) {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]') || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (draft) {
        draft = null;
        renderComposer();
        recompute();
      } else if (commentMode) setCommentMode(false);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'c' || e.key === 'C') && current.view?.proto && current.state?.page !== 'setup') {
      e.preventDefault();
      setCommentMode(!commentMode);
    }
  }

  // ---- panel events ------------------------------------------------------------
  panel.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.closest('[data-thread]')?.dataset.thread;
    const cid = el.closest('[data-comment]')?.dataset.comment;
    if (a === 'close') setPanel(false);
    else if (a === 'new') setCommentMode(!commentMode);
    else if (a === 'retry') connect();
    else if (a === 'local-on') {
      siteStorage.set('comments-local', true);
      connect();
    } else if (a === 'local-off') {
      if (!confirm('Turn off comments in this browser? The comments you saved here are kept and come back if you turn it on again.')) return;
      siteStorage.set('comments-local', null);
      threads = [];
      counts = {};
      onCounts?.(counts);
      setCommentMode(false);
      connect();
    } else if (a === 'sign-out') {
      if (!confirm(backend.needsPassword ? 'Sign out? You’ll need the comment password to sign in again.' : 'Sign out?')) return;
      await act(async () => {
        await backend.signOut();
        me = null;
        status = 'signed-out';
        threads = [];
        counts = {};
        onCounts?.(counts);
        setCommentMode(false);
        renderAll();
      });
    } else if (a === 'rename') {
      renaming = !renaming;
      renderPanel();
      panel.querySelector('.pv-rename [name=name]')?.focus();
    } else if (a === 'open-thread') {
      if (selectedId() === id) deselect();
      else selectThread(id);
    } else if (a === 'resolve' || a === 'reopen') {
      await act(async () => {
        await backend.setStatus(id, a === 'resolve' ? 'resolved' : 'open');
        const t = threads.find((x) => x.id === id);
        t.status = a === 'resolve' ? 'resolved' : 'open';
        if (a === 'resolve') deselect();
        loadCounts();
        renderAll();
      });
    } else if (a === 'edit') {
      editing = cid;
      renderPanel();
      panel.querySelector(`[data-comment="${cid}"] textarea`)?.focus();
    } else if (a === 'cancel-edit') {
      editing = null;
      renderPanel();
    } else if (a === 'save-edit') {
      const body = panel.querySelector(`[data-comment="${cid}"] textarea`).value.trim();
      if (!body) return;
      await act(async () => {
        await backend.editComment(cid, body);
        const c = threads.flatMap((t) => t.comments).find((x) => x.id === cid);
        Object.assign(c, { body, editedAt: new Date().toISOString() });
        editing = null;
        renderPanel();
      });
    } else if (a === 'delete') {
      if (!confirm('Delete this comment?')) return;
      await act(async () => {
        await backend.deleteComment(cid);
        const t = threads.find((x) => x.comments.some((c) => c.id === cid));
        t.comments = t.comments.filter((c) => c.id !== cid);
        if (!t.comments.length) deselect();
        loadCounts();
        renderAll();
      });
    }
  });

  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.classList.contains('pv-signin')) return signIn(form);
    if (form.classList.contains('pv-rename')) return rename(form);
    const id = form.closest('[data-thread]')?.dataset.thread;
    const textarea = form.querySelector('textarea');
    const body = textarea.value.trim();
    if (!body || !id) return;
    await act(async () => {
      const c = await backend.addComment(id, body);
      threads.find((t) => t.id === id).comments.push(c);
      replyDrafts.delete(id);
      renderPanel();
      panel.querySelector(`[data-thread="${id}"] textarea`)?.focus();
    });
  });

  const SIGN_IN_ERRORS = {
    'wrong-password': 'That password isn’t right.',
    'too-many-attempts': 'Too many wrong passwords. Wait 15 minutes and try again.',
    'invalid-name': 'Enter your name (up to 80 characters).',
    'unknown-project': 'This site’s comment project wasn’t found.',
    'not-signed-in': 'Couldn’t start a session. Try again.',
  };

  async function signIn(form) {
    const get = (n) => form.querySelector(`[name=${n}]`)?.value ?? '';
    const name = get('name').trim();
    if (!name) {
      form.querySelector('[name=name]').focus();
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const r = await backend.signIn({ password: get('password'), name, email: get('email').trim() });
      if (!r.ok) {
        signInError = SIGN_IN_ERRORS[r.reason] ?? 'Couldn’t sign in.';
        lastPanelHtml = '';
        renderPanel();
        const pw = panel.querySelector('.pv-signin [name=password]');
        if (pw) { pw.value = ''; pw.focus(); }
        return;
      }
      prefs.set('author', { name, email: get('email').trim() });
      signInError = '';
      me = r.me;
      project = r.project;
      status = 'ready';
      loadedSlug = null;
      await Promise.all([loadThreads(), loadCounts()]);
      renderAll();
    } catch (err) {
      signInError = err.message;
      lastPanelHtml = '';
      renderPanel();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async function rename(form) {
    const name = form.querySelector('[name=name]').value.trim();
    const email = form.querySelector('[name=email]').value.trim();
    if (!name) return;
    await act(async () => {
      if (await backend.setName({ name, email })) {
        me = { name, email };
        prefs.set('author', { name, email });
      }
      renaming = false;
      renderPanel();
    });
  }

  panel.addEventListener('input', (e) => {
    const id = e.target.closest('[data-thread]')?.dataset.thread;
    if (id && e.target.name === 'reply') replyDrafts.set(id, e.target.value);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.name === 'reply') {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    postDraft();
  });
  composer.addEventListener('click', (e) => {
    if (e.target.closest('[data-action=cancel-draft]')) {
      draft = null;
      renderComposer();
      recompute();
    }
  });
  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      postDraft();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      draft = null;
      renderComposer();
      recompute();
    }
  });

  // ---- rendering ---------------------------------------------------------------
  function renderAll() {
    app.classList.toggle('pv-comments-open', panelOpen && current.state?.page !== 'setup');
    renderButton();
    renderPanel();
    recompute();
  }

  function renderButton() {
    const n = counts[current.state?.slug] ?? 0;
    button.innerHTML = `${icons.comment}<span>Comments</span>${status === 'ready' && n ? `<span class="pv-count" aria-label="${n} open">${n}</span>` : ''}`;
    button.setAttribute('aria-pressed', String(panelOpen));
    button.hidden = current.state?.page === 'setup';
  }

  function renderPanel() {
    const head = `
      <div class="pv-c-head">
        <h2>Comments</h2>
        ${status === 'ready' ? `<button type="button" class="pv-button pv-c-new" data-action="new" aria-pressed="${commentMode}" title="Add a comment (C)">${icons.plus}<span>${commentMode ? 'Click the prototype…' : 'Add comment'}</span></button>` : ''}
        <button type="button" class="pv-icon-button" data-action="close" aria-label="Close comments" title="Close">${icons.close}</button>
      </div>`;
    if (status !== 'ready') {
      let t = STATUS_TEXT[status] ?? STATUS_TEXT.error;
      if (status === 'signed-out' && !backend?.needsPassword) {
        t = { title: 'Add your name to start commenting', body: 'Comments are saved only in this browser; nobody else sees them.' };
      }
      const actions = {
        'not-configured': `<a class="pv-button pv-primary" href="#/setup">How to set up comments</a>
          <button type="button" class="pv-link" data-action="local-on">Try comments in this browser</button>
          <p class="pv-c-note">Comments you add then are saved only in this browser, and nobody else sees them.</p>`,
        'signed-out': signInForm(),
        'unknown-project': `<p class="pv-c-note">Setting this site up? See the <a href="#/setup">setup guide</a>.</p>`,
        error: `<button type="button" class="pv-button" data-action="retry">Try again</button>
          <p class="pv-c-note">Setting this site up? The <a href="#/setup">setup guide</a> has a connection check.</p>`,
        connecting: '',
      }[status] ?? '';
      const html = `${head}<div class="pv-c-body pv-c-state" data-status="${status}">
        <h3>${t.title}</h3>${t.body ? `<p>${t.body}</p>` : ''}${status === 'error' && message ? `<p class="pv-c-error">${escapeHtml(message)}</p>` : ''}
        <div class="pv-c-actions">${actions}</div></div>`;
      if (html !== lastPanelHtml) {
        lastPanelHtml = html;
        panel.innerHTML = html;
      }
      return;
    }

    const list = shown();
    const nums = numbers();
    const open = list.filter((t) => t.status === 'open');
    const resolved = list.filter((t) => t.status === 'resolved');
    const sel = selectedId();
    const loading = loadedSlug !== current.state?.slug;
    const body = loading
      ? '<p class="pv-c-empty">Loading…</p>'
      : !list.length
        ? `<p class="pv-c-empty">No comments on this prototype yet.<br />Press <kbd>C</kbd> or <strong>Add comment</strong>, then click where your comment belongs.</p>`
        : `${open.map((t) => threadHtml(t, nums.get(t.id), sel)).join('') || '<p class="pv-c-empty">No open comments.</p>'}
           ${resolved.length ? `<details class="pv-c-resolved" ${resolved.some((t) => t.id === sel) ? 'open' : ''}><summary>Resolved (${resolved.length})</summary>${resolved.map((t) => threadHtml(t, nums.get(t.id), sel)).join('')}</details>` : ''}`;

    const who = `Signed in as <strong>${escapeHtml(me?.name ?? '')}</strong>
      <button type="button" class="pv-link" data-action="rename">Change name</button>
      <button type="button" class="pv-link" data-action="sign-out">Sign out</button>`;
    const renameForm = renaming
      ? `<form class="pv-rename">
           <input name="name" value="${escapeHtml(me?.name ?? '')}" maxlength="80" aria-label="Your name" required />
           <input name="email" type="email" value="${escapeHtml(me?.email ?? '')}" maxlength="200" placeholder="Email (optional)" aria-label="Email (optional)" />
           <div class="pv-reply-actions"><button type="button" class="pv-button" data-action="rename">Cancel</button><button type="submit" class="pv-button pv-primary">Save</button></div>
           <p class="pv-c-note">Applies to your new comments.</p>
         </form>`
      : '';
    const foot = backend.kind === 'local'
      ? `<p class="pv-c-note">${icons.info} Saved only in this browser. <button type="button" class="pv-link" data-action="local-off">Turn off</button></p>
         <p class="pv-c-note">${who}</p>${renameForm}`
      : `<p class="pv-c-note">${project?.name ? `${escapeHtml(project.name)} · ` : ''}Shared with everyone signed in to this project.</p>
         <p class="pv-c-note">${who}</p>${renameForm}`;

    const html = `${head}
      ${errorText ? `<p class="pv-c-error" role="alert">${escapeHtml(errorText)}</p>` : ''}
      <div class="pv-c-body">${body}</div>
      <div class="pv-c-foot">${foot}</div>`;
    // Replacing the panel's DOM while someone is clicking it loses the click (e.g. a
    // refresh on window focus between mousedown and mouseup), so only redraw on change.
    if (html !== lastPanelHtml) {
      lastPanelHtml = html;
      const scrollTop = panel.querySelector('.pv-c-body')?.scrollTop ?? 0;
      const active = document.activeElement;
      const activeKey = panel.contains(active) && active.name ? `${active.closest('[data-thread]')?.dataset.thread}:${active.name}` : null;
      panel.innerHTML = html;
      panel.querySelector('.pv-c-body').scrollTop = scrollTop;
      if (activeKey) {
        const [tid, name] = activeKey.split(':');
        panel.querySelector(`[data-thread="${tid}"] [name="${name}"]`)?.focus();
      }
    }
    if (sel && pendingScroll === sel) panel.querySelector(`[data-thread="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function threadHtml(t, n, sel) {
    const selected = t.id === sel;
    const b = badge(t);
    const first = t.comments[0];
    const v = current.view;
    const variantLabel = (v.proto.variants ?? []).find((x) => x.id === t.variant)?.label ?? t.variant;
    const chips = [
      !inCurrentView(t) && t.variant && t.variant !== v.variant ? `Variant: ${escapeHtml(variantLabel)}` : '',
      t.snapshot && t.snapshot !== v.snapshot ? `Version ${escapeHtml(t.snapshot)}` : '',
      t.viewport?.width ? `${t.viewport.width} px` : '',
      t.theme === 'dark' ? 'Dark' : '',
    ].filter(Boolean);
    const badgeHtml = b
      ? `<span class="pv-badge" data-kind="${b.kind}" title="${b.title}">${b.label}</span>${b.hidden ? '<span class="pv-badge" data-kind="hidden" title="The element exists but isn’t visible right now (other width, closed dialog or collapsed section).">Not visible here</span>' : ''}`
      : '';
    const replies = t.comments.length - 1;
    const me = backend.userId;
    const comments = selected ? t.comments : [first];
    return `
      <article class="pv-thread" data-thread="${t.id}" ${selected ? 'aria-current="true"' : ''} data-status="${t.status}">
        <button type="button" class="pv-thread-head" data-action="open-thread" aria-expanded="${selected}">
          <span class="pv-thread-n">${n}</span>
          <span class="pv-thread-on" title="Attached to">${escapeHtml(anchorLabel(t.anchor))}</span>
          ${badgeHtml}
        </button>
        ${comments.map((c) => commentHtml(c, me, selected)).join('')}
        ${!selected && replies ? `<button type="button" class="pv-link pv-replies" data-action="open-thread">${replies} ${replies === 1 ? 'reply' : 'replies'}</button>` : ''}
        ${chips.length ? `<p class="pv-chips">${chips.map((c) => `<span>${c}</span>`).join('')}</p>` : ''}
        ${selected ? `
          <form class="pv-reply">
            <textarea name="reply" rows="2" placeholder="Reply…" aria-label="Reply" maxlength="5000">${escapeHtml(replyDrafts.get(t.id) ?? '')}</textarea>
            <div class="pv-reply-actions">
              ${t.status === 'open'
                ? '<button type="button" class="pv-button" data-action="resolve">Resolve</button>'
                : '<button type="button" class="pv-button" data-action="reopen">Reopen</button>'}
              <button type="submit" class="pv-button pv-primary">Reply</button>
            </div>
          </form>` : ''}
      </article>`;
  }

  function commentHtml(c, me, expanded) {
    const mine = c.authorId && c.authorId === me;
    const isEditing = editing === c.id;
    return `
      <div class="pv-comment" data-comment="${c.id}">
        <p class="pv-comment-meta"><strong>${escapeHtml(c.authorName)}</strong>
          <time datetime="${c.createdAt}" title="${new Date(c.createdAt).toLocaleString()}">${relativeTime(c.createdAt)}</time>${c.editedAt ? ' · edited' : ''}
          ${expanded && mine && !isEditing ? `<span class="pv-comment-tools"><button type="button" class="pv-link" data-action="edit">Edit</button><button type="button" class="pv-link" data-action="delete">Delete</button></span>` : ''}
        </p>
        ${isEditing
          ? `<textarea name="edit" rows="3" maxlength="5000" aria-label="Edit comment">${escapeHtml(c.body)}</textarea>
             <div class="pv-reply-actions"><button type="button" class="pv-button" data-action="cancel-edit">Cancel</button><button type="button" class="pv-button pv-primary" data-action="save-edit">Save</button></div>`
          : `<p class="pv-comment-body ${expanded ? '' : 'pv-clamp'}">${escapeHtml(c.body)}</p>`}
      </div>`;
  }

  function signInForm() {
    const saved = prefs.get('author', { name: '', email: '' });
    return `
      <form class="pv-signin">
        ${project?.name && backend?.shared ? `<p class="pv-c-note">Project: <strong>${escapeHtml(project.name)}</strong></p>` : ''}
        ${backend?.needsPassword ? '<label>Comment password<input name="password" type="password" autocomplete="current-password" required /></label>' : ''}
        <label>Your name<input name="name" value="${escapeHtml(saved.name)}" autocomplete="name" maxlength="80" required /></label>
        <label><span>Email <span class="pv-optional">(optional)</span></span><input name="email" type="email" value="${escapeHtml(saved.email ?? '')}" autocomplete="email" maxlength="200" /></label>
        ${signInError ? `<p class="pv-c-error" role="alert">${escapeHtml(signInError)}</p>` : ''}
        <button type="submit" class="pv-button pv-primary">${backend?.needsPassword ? 'Sign in' : 'Start commenting'}</button>
        ${backend?.needsPassword ? '<p class="pv-c-note">Your name is shown with your comments.</p>' : '<p class="pv-c-note">Your name is shown with your comments in this browser.</p>'}
      </form>`;
  }

  function renderComposer() {
    composer.hidden = !draft;
    if (!draft) {
      composer.innerHTML = '';
      delete composer.dataset.for;
      return;
    }
    if (composer.dataset.for === JSON.stringify(draft.anchor)) return;
    composer.dataset.for = JSON.stringify(draft.anchor);
    composer.innerHTML = `
      <p class="pv-composer-on">On <strong>${escapeHtml(anchorLabel(draft.anchor))}</strong></p>
      <textarea rows="3" placeholder="Add a comment…" aria-label="Comment" maxlength="5000" required></textarea>
      <div class="pv-reply-actions">
        <button type="button" class="pv-button" data-action="cancel-draft">Cancel</button>
        <button type="submit" class="pv-button pv-primary">Post</button>
      </div>`;
    requestAnimationFrame(() => (composer.querySelector('[name=author-name]') ?? composer.querySelector('textarea')).focus());
  }

  function positionComposer(pos) {
    const p = overlay.toCanvas(pos.x, pos.y);
    const cw = stage.canvas.clientWidth;
    const ch = stage.canvas.clientHeight;
    const w = composer.offsetWidth || 300;
    const h = composer.offsetHeight || 180;
    let left = p.x + 20;
    if (left + w > cw - 8) left = Math.max(8, p.x - w - 20);
    const top = Math.min(Math.max(8, p.y - 20), Math.max(8, ch - h - 8));
    composer.style.left = `${left}px`;
    composer.style.top = `${top}px`;
  }

  // ---- public API (called by main.js) --------------------------------------------
  connect();

  return {
    enabled: true,
    /** Every render of the viewer. */
    view(state, view) {
      const slugChanged = state.slug !== current.state?.slug;
      const prevThread = current.state?.extra?.thread;
      current = { state, view };
      if (state.extra?.thread && state.extra.thread !== prevThread) {
        pendingScroll = state.extra.thread;
        if (!panelOpen) {
          panelOpen = true;
          prefs.set('comments-panel', true);
        }
      }
      if (slugChanged) {
        threads = [];
        loadedSlug = null;
        draft = null;
        renderComposer();
        loadThreads();
      }
      renderAll();
    },
    documentReady() {
      if (stage.doc) overlay.attach(stage.doc);
      overlay.setMode(commentMode);
    },
    documentGone() {
      overlay.detach();
      resolution = new Map();
    },
    layout(info) {
      overlay.layout(info);
    },
    refresh,
  };
}
