/**
 * The comment layer over the prototype frame (docs/SPEC.md §6.1, §6.4).
 *
 * Pins are drawn in the viewer, not inside the prototype, in a layer that sits
 * exactly over the frame and is clipped to it. Positions come in frame-viewport
 * coordinates and are mapped through the stage's offset and scale, so pins keep
 * their size when the frame is scaled to fit.
 *
 * In comment mode the layer listens inside the prototype document (same origin,
 * §5.3): clicks are captured before the prototype sees them, the element under the
 * pointer is outlined, and the cursor is a crosshair.
 */
import { anchorFromEvent } from './anchor.js';

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend', 'submit'];

export function createOverlay(stage, { onPinClick, onPick, onChange, onKey }) {
  const layer = document.createElement('div');
  layer.className = 'pv-pins';
  layer.innerHTML = '<div class="pv-hover" hidden></div>';
  stage.canvas.append(layer);
  const hover = layer.querySelector('.pv-hover');

  let layout = { left: 0, top: 0, scale: 1, width: 0, height: 0 };
  let doc = null;
  let commentMode = false;
  let detachDoc = () => {};
  let frame = 0;
  let modeStyle = null;

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };

  function place() {
    layer.style.left = `${layout.left}px`;
    layer.style.top = `${layout.top}px`;
    layer.style.width = `${layout.width * layout.scale}px`;
    layer.style.height = `${layout.height * layout.scale}px`;
  }

  layer.addEventListener('click', (e) => {
    const pin = e.target.closest('.pv-pin[data-id]');
    if (pin) onPinClick(pin.dataset.id);
  });

  function attach(newDoc) {
    detach();
    doc = newDoc;
    const win = doc.defaultView;
    const style = doc.createElement('style');
    style.id = 'pv-comment-mode-style';
    style.textContent = '*, *::before, *::after { cursor: crosshair !important; }';

    const block = (e) => {
      if (!commentMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click') {
        const picked = anchorFromEvent(e);
        if (picked) onPick({ anchor: picked.anchor, x: e.clientX, y: e.clientY });
      }
    };
    const move = (e) => {
      if (!commentMode) return;
      const picked = anchorFromEvent(e);
      const r = picked?.element.getBoundingClientRect();
      hover.hidden = !r;
      if (r) {
        Object.assign(hover.style, {
          left: `${r.left * layout.scale}px`, top: `${r.top * layout.scale}px`,
          width: `${r.width * layout.scale}px`, height: `${r.height * layout.scale}px`,
        });
        hover.dataset.label = picked.anchor.label;
      }
    };
    const leave = () => { hover.hidden = true; };
    const key = (e) => onKey?.(e);

    for (const t of BLOCKED) win.addEventListener(t, block, { capture: true, passive: false });
    win.addEventListener('pointermove', move, { capture: true, passive: true });
    doc.documentElement.addEventListener('pointerleave', leave);
    win.addEventListener('keydown', key, true);
    win.addEventListener('scroll', schedule, { capture: true, passive: true });
    win.addEventListener('resize', schedule);
    win.addEventListener('transitionend', schedule, true);
    win.addEventListener('animationend', schedule, true);
    const mo = new MutationObserver(schedule);
    mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

    modeStyle = style;
    if (commentMode) doc.head.append(style);
    detachDoc = () => {
      for (const t of BLOCKED) win.removeEventListener(t, block, { capture: true });
      win.removeEventListener('pointermove', move, { capture: true });
      win.removeEventListener('keydown', key, true);
      win.removeEventListener('scroll', schedule, { capture: true });
      win.removeEventListener('resize', schedule);
      win.removeEventListener('transitionend', schedule, true);
      win.removeEventListener('animationend', schedule, true);
      mo.disconnect();
      style.remove();
    };
    schedule();
  }

  function detach() {
    detachDoc();
    detachDoc = () => {};
    doc = null;
    hover.hidden = true;
    setPins([]);
  }

  function setMode(on) {
    commentMode = on;
    layer.classList.toggle('pv-commenting', on);
    stage.canvas.classList.toggle('pv-commenting', on);
    if (!on) hover.hidden = true;
    if (doc && modeStyle) {
      if (on) doc.head.append(modeStyle);
      else modeStyle.remove();
    }
  }

  /** pins: [{ id, n, x, y, selected, resolved }] in frame coordinates; draft: { x, y } | null */
  function setPins(pins, draft = null) {
    const existing = new Map([...layer.querySelectorAll('.pv-pin[data-id]')].map((el) => [el.dataset.id, el]));
    for (const p of pins) {
      let el = existing.get(p.id);
      existing.delete(p.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'pv-pin';
        el.dataset.id = p.id;
        layer.append(el);
      }
      el.textContent = String(p.n);
      el.setAttribute('aria-label', `Comment ${p.n}`);
      el.title = `Comment ${p.n}`;
      el.toggleAttribute('data-resolved', !!p.resolved);
      if (p.selected) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
      el.style.left = `${p.x * layout.scale}px`;
      el.style.top = `${p.y * layout.scale}px`;
    }
    for (const el of existing.values()) el.remove();
    let d = layer.querySelector('.pv-pin-draft');
    if (draft) {
      if (!d) {
        d = document.createElement('span');
        d.className = 'pv-pin pv-pin-draft';
        d.setAttribute('aria-hidden', 'true');
        d.textContent = '+';
        layer.append(d);
      }
      d.style.left = `${draft.x * layout.scale}px`;
      d.style.top = `${draft.y * layout.scale}px`;
    } else d?.remove();
  }

  return {
    attach,
    detach,
    setMode,
    setPins,
    schedule,
    layout(info) {
      layout = info;
      place();
      schedule();
    },
    /** Frame coordinates → canvas coordinates (for the composer card). */
    toCanvas(x, y) {
      return { x: layout.left + x * layout.scale, y: layout.top + y * layout.scale };
    },
    get layoutInfo() {
      return layout;
    },
    get doc() {
      return doc;
    },
  };
}
