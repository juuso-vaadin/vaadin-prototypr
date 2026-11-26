/**
 * The stage: the prototype iframe at a chosen width (SPEC.md §5.1, §5.3).
 *
 * - Width is the iframe's own width, so the prototype's media queries behave as on
 *   a real screen. When the width doesn't fit, the frame is scaled down to fit (the
 *   prototype still sees the full width) and the scale is shown.
 * - Handles on both edges drag a custom width (the frame stays centred).
 * - The light/dark scheme is applied through the theme adapter as soon as the new
 *   document exists, before first paint, and again on DOMContentLoaded and load.
 * - `onReady({ ms })` fires when the prototype is usable: load event done, every
 *   custom element in the page defined, and two frames painted.
 */
import { applyColorScheme } from './theme-adapters.js';
import { clampWidth } from './state.js';

const GUTTER_X = 20; // room for the drag handles
const GUTTER_Y = 16;

export function createStage(host, { onWidthChange, onReady } = {}) {
  host.classList.add('pv-stage');
  host.innerHTML = `
    <div class="pv-progress" hidden></div>
    <div class="pv-canvas">
      <div class="pv-device">
        <div class="pv-handle" data-side="-1" title="Drag to resize" aria-hidden="true"></div>
        <iframe class="pv-frame" title="Prototype"></iframe>
        <div class="pv-handle" data-side="1" title="Drag to resize" aria-hidden="true"></div>
      </div>
      <div class="pv-message" hidden></div>
    </div>`;
  const canvas = host.querySelector('.pv-canvas');
  const device = host.querySelector('.pv-device');
  const iframe = host.querySelector('iframe');
  const progress = host.querySelector('.pv-progress');
  const message = host.querySelector('.pv-message');

  let current = { url: null, theme: 'aura', scheme: 'light' };
  let width = null; // null = Full
  let layoutInfo = { width: 0, height: 0, scale: 1 };
  let loadToken = 0;
  let loadStart = 0;
  let watchedDoc = null;

  // --- color scheme -------------------------------------------------------------
  function applyScheme(doc = safeDoc()) {
    if (doc && doc.URL !== 'about:blank') applyColorScheme(doc, current.theme, current.scheme);
  }
  function safeDoc() {
    try {
      return iframe.contentDocument;
    } catch {
      return null; // cross-origin: not expected, prototypes are same-origin (§5.3)
    }
  }
  /** Polls each frame until the next document exists, then styles it before it paints. */
  function watchForNewDocument(previousDoc) {
    const token = loadToken;
    const tick = () => {
      if (token !== loadToken) return;
      const doc = safeDoc();
      if (doc && doc !== previousDoc && doc.URL !== 'about:blank' && doc.documentElement) {
        attach(doc);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
  function attach(doc) {
    if (watchedDoc === doc) return;
    watchedDoc = doc;
    applyScheme(doc);
    doc.addEventListener('DOMContentLoaded', () => applyScheme(doc), { once: true });
  }

  iframe.addEventListener('load', async () => {
    const doc = safeDoc();
    if (!doc || doc.URL === 'about:blank') return;
    attach(doc);
    applyScheme(doc);
    // The prototype may reload itself; style the next document early as well.
    const win = iframe.contentWindow;
    win.addEventListener('pagehide', () => {
      loadToken++;
      loadStart = performance.now();
      progress.hidden = false;
      watchForNewDocument(doc);
    }, { once: true });

    const token = loadToken;
    // Wait for custom elements the page itself uses. Undefined elements inside a
    // defined component (e.g. vaadin-grid-cell-content) are internal helpers that
    // are never registered, so they're skipped.
    const isDefinedHost = (el) => el && el.localName.includes('-') && !!win.customElements.get(el.localName);
    const pending = [...new Set([...doc.querySelectorAll(':not(:defined)')]
      .filter((el) => el.localName.includes('-') && !isDefinedHost(el.parentElement))
      .map((el) => el.localName))];
    await Promise.race([
      Promise.all([...pending.map((n) => win.customElements.whenDefined(n)), doc.fonts?.ready]),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    await new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
    if (token !== loadToken) return;
    progress.hidden = true;
    const ms = Math.round(performance.now() - loadStart);
    host.dataset.ready = 'true';
    onReady?.({ ms, url: current.url });
  });

  // --- layout -------------------------------------------------------------------
  function layout() {
    const availW = Math.max(0, canvas.clientWidth - GUTTER_X * 2);
    const availH = Math.max(0, canvas.clientHeight - GUTTER_Y * 2);
    const w = width ?? availW;
    const scale = width ? Math.min(1, availW / width) : 1;
    const h = Math.round(availH / scale);
    device.style.width = `${w}px`;
    device.style.height = `${h}px`;
    device.style.transform = scale < 1 ? `scale(${scale})` : '';
    device.style.left = `${Math.round((canvas.clientWidth - w * scale) / 2)}px`;
    device.style.top = `${GUTTER_Y}px`;
    host.classList.toggle('pv-full', !width);
    layoutInfo = { width: Math.round(w), height: h, scale };
    host.dispatchEvent(new CustomEvent('stage-layout', { detail: layoutInfo }));
  }
  new ResizeObserver(layout).observe(canvas);

  // --- drag to resize -----------------------------------------------------------
  for (const handle of host.querySelectorAll('.pv-handle')) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const side = Number(handle.dataset.side);
      const startX = e.clientX;
      const startW = layoutInfo.width;
      const startScale = layoutInfo.scale;
      host.classList.add('pv-dragging');
      const move = (ev) => {
        width = clampWidth(startW + (2 * side * (ev.clientX - startX)) / startScale);
        layout();
        onWidthChange?.(width, { final: false });
      };
      const up = () => {
        host.classList.remove('pv-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        onWidthChange?.(width, { final: true });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  return {
    iframe,
    /** Loads a prototype URL. Same URL: only the scheme is re-applied (no reload). */
    show({ url, theme, scheme }) {
      message.hidden = true;
      device.hidden = false;
      const reload = url !== current.url;
      current = { url, theme, scheme };
      if (!reload) {
        applyScheme();
        return;
      }
      loadToken++;
      loadStart = performance.now();
      host.dataset.ready = 'false';
      progress.hidden = false;
      const previousDoc = safeDoc();
      iframe.src = url;
      watchForNewDocument(previousDoc);
    },
    setWidth(w) {
      if (w === width) return;
      width = w;
      layout();
    },
    showMessage(html) {
      loadToken++;
      current.url = null;
      iframe.removeAttribute('src');
      device.hidden = true;
      progress.hidden = true;
      message.innerHTML = html;
      message.hidden = false;
    },
    get layout() {
      return layoutInfo;
    },
  };
}
