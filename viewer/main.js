/**
 * Prototype viewer entry point (SPEC.md §5).
 *
 *   import { startViewer } from './viewer/main.js';
 *   startViewer(document.querySelector('#app'), { manifestUrl: 'manifest.json' });
 *
 * The viewer is plain ES modules with no dependencies and no knowledge of the
 * repository around it beyond the manifest, so it can later move into a shared
 * package (C9). It never loads a prototype into its own document: prototypes
 * always run in an iframe, so different Vaadin versions never meet (§7.2).
 */
import { createStore } from './state.js';
import { createStage } from './stage.js';
import { createSidebar } from './sidebar.js';
import { createSizeMenu, createTopBar } from './toolbar.js';
import { escapeHtml, prefs } from './util.js';

export async function startViewer(root, { manifestUrl = 'manifest.json' } = {}) {
  root.classList.add('pv-app');
  root.innerHTML = `
    <aside class="pv-side"></aside>
    <div class="pv-main">
      <header></header>
      <main class="pv-stage-host"></main>
    </div>
    <div class="pv-scrim" hidden></div>`;
  const side = root.querySelector('.pv-side');
  const scrim = root.querySelector('.pv-scrim');

  let manifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    manifest = await res.json();
  } catch (e) {
    root.querySelector('.pv-stage-host').innerHTML = `<div class="pv-message">Could not load <code>${escapeHtml(manifestUrl)}</code> (${escapeHtml(e.message)}).<br>Run <code>node scripts/build-manifest.mjs</code> first.</div>`;
    return;
  }
  const prototypes = manifest.prototypes ?? [];
  const bySlug = new Map(prototypes.map((p) => [p.slug, p]));
  const store = createStore();

  // Sidebar: open by default on wide screens; remembered per browser.
  const narrow = () => matchMedia('(max-width: 800px)').matches;
  let sidebarOpen = narrow() ? false : prefs.get('sidebar', true);
  const applySidebar = () => {
    root.classList.toggle('pv-sidebar-closed', !sidebarOpen);
    scrim.hidden = !(sidebarOpen && narrow());
  };
  const toggleSidebar = (open = !sidebarOpen) => {
    sidebarOpen = open;
    if (!narrow()) prefs.set('sidebar', sidebarOpen);
    applySidebar();
  };
  scrim.addEventListener('click', () => toggleSidebar(false));
  applySidebar();

  const sidebar = createSidebar(side, { prototypes });
  side.addEventListener('click', (e) => {
    if (e.target.closest('a.pv-item') && narrow()) toggleSidebar(false);
  });
  const topBar = createTopBar(root.querySelector('header'), {
    onChange: (patch, opts) => store.set(patch, opts),
    onToggleSidebar: () => toggleSidebar(),
  });
  const sizeMenu = createSizeMenu(root.querySelector('header [data-role=size]'), {
    onChange: (width) => store.set({ width }, { replace: true }),
  });
  const stageHost = root.querySelector('.pv-stage-host');
  const stage = createStage(stageHost, {
    onWidthChange: (width, { final }) => {
      sizeMenu.setWidth(width);
      if (final) store.set({ width }, { replace: true });
    },
    onReady: ({ ms, url }) => {
      // Exposed for tests and for anyone curious about switch timing (§7.1).
      window.__protoViewer = { ...(window.__protoViewer ?? {}), lastReadyMs: ms, lastReadyUrl: url, readyCount: (window.__protoViewer?.readyCount ?? 0) + 1 };
      root.dispatchEvent(new CustomEvent('prototype-ready', { detail: { ms, url }, bubbles: true }));
    },
  });
  stageHost.addEventListener('stage-layout', (e) => sizeMenu.setLayout(e.detail));

  // Keyboard: "/" focuses search (when not typing somewhere).
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      if (!sidebarOpen) toggleSidebar(true);
      sidebar.focusSearch();
    }
  });

  /** Turns the URL state into what to show; fixes up unknown variants/snapshots. */
  function resolve(state) {
    const proto = state.slug ? bySlug.get(state.slug) : null;
    if (!proto) return { proto: null };
    const variants = proto.variants ?? [];
    const variant = variants.find((v) => v.id === state.variant)?.id ?? variants[0]?.id ?? null;
    const snapshot = (proto.snapshots ?? []).find((s) => s.id === state.snapshot)?.id ?? null;
    const path = proto.path + (snapshot ? `${snapshot}/` : '');
    const url = new URL(path, document.baseURI);
    if (variant) url.searchParams.set('variant', variant);
    return { proto, variant, snapshot, frameUrl: url.href, theme: proto.theme ?? manifest.defaultTheme ?? 'aura' };
  }

  function render(state) {
    // No prototype in the URL: open the first one that isn't archived.
    if (!state.slug) {
      const first = [...prototypes].sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.title.localeCompare(b.title))
        .find((p) => p.status !== 'archived') ?? prototypes[0];
      if (first) return store.set({ slug: first.slug }, { replace: true });
    }
    const view = resolve(state);
    // Drop a variant/snapshot id that the prototype doesn't have (keeps links clean).
    if (view.proto && ((state.variant && state.variant !== view.variant) || (state.snapshot && state.snapshot !== view.snapshot))) {
      return store.set({ variant: state.variant === view.variant ? state.variant : null, snapshot: view.snapshot }, { replace: true });
    }
    sidebar.render(state);
    topBar.render(state, view);
    sizeMenu.setWidth(state.width);
    stage.setWidth(state.width);
    document.title = view.proto ? `${view.proto.title} · ${manifest.customer || 'Prototypes'}` : `${manifest.customer || 'Prototypes'}`;
    if (!view.proto) {
      stage.showMessage(prototypes.length
        ? `No prototype called <code>${escapeHtml(state.slug)}</code>. Pick one from the list.`
        : 'No prototypes yet. Add one under <code>prototypes/&lt;slug&gt;/</code>.');
      return;
    }
    stage.show({ url: view.frameUrl, theme: view.theme, scheme: state.scheme });
  }

  store.subscribe(render);
  render(store.get());
  return { store, stage };
}
