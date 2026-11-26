/**
 * View state <-> URL hash (SPEC.md §5.1 "Deep links").
 *
 *   #/p/<slug>?variant=b&snapshot=v1&w=390&theme=dark&thread=<id>
 *
 * The hash holds all view state, so copying the URL copies the view. Parameters
 * the viewer doesn't know are kept as they are (M3 adds thread and t).
 */

const KNOWN = ['variant', 'snapshot', 'w', 'theme'];
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 2560;

/** @typedef {{ slug: string|null, variant: string|null, snapshot: string|null, width: number|null, scheme: 'light'|'dark', extra: Record<string,string> }} ViewState */

/** @returns {ViewState} */
export function parseHash(hash) {
  const raw = hash.replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const m = path.match(/^\/p\/([^/]+)\/?$/);
  const params = new URLSearchParams(query);
  const w = Number.parseInt(params.get('w') ?? '', 10);
  const extra = {};
  for (const [k, v] of params) if (!KNOWN.includes(k)) extra[k] = v;
  return {
    slug: m ? decodeURIComponent(m[1]) : null,
    variant: params.get('variant') || null,
    snapshot: params.get('snapshot') || null,
    width: Number.isFinite(w) ? clampWidth(w) : null, // null = Full
    scheme: params.get('theme') === 'dark' ? 'dark' : 'light',
    extra,
  };
}

/** @param {ViewState} s */
export function formatHash(s) {
  if (!s.slug) return '';
  const params = new URLSearchParams();
  if (s.variant) params.set('variant', s.variant);
  if (s.snapshot) params.set('snapshot', s.snapshot);
  if (s.width) params.set('w', String(s.width));
  if (s.scheme === 'dark') params.set('theme', 'dark');
  for (const [k, v] of Object.entries(s.extra ?? {})) params.set(k, v);
  const q = params.toString();
  return `#/p/${encodeURIComponent(s.slug)}${q ? `?${q}` : ''}`;
}

export function clampWidth(w) {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
}

/**
 * A tiny store backed by location.hash. `set(patch)` adds a history entry unless
 * `{ replace: true }`; back/forward restore earlier views.
 */
export function createStore(win = window) {
  let state = parseHash(win.location.hash);
  const listeners = new Set();
  const emit = (prev) => listeners.forEach((fn) => fn(state, prev));

  win.addEventListener('hashchange', () => {
    const prev = state;
    state = parseHash(win.location.hash);
    emit(prev);
  });

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(patch, { replace = false } = {}) {
      const prev = state;
      state = { ...state, ...patch };
      const hash = formatHash(state);
      if (hash !== win.location.hash) {
        const url = `${win.location.pathname}${win.location.search}${hash}`;
        // pushState/replaceState don't fire hashchange, so emit ourselves.
        if (replace) win.history.replaceState(null, '', url);
        else win.history.pushState(null, '', url);
      }
      emit(prev);
    },
  };
}
