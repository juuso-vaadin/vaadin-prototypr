/**
 * Viewer controls (SPEC.md §5.1):
 *   - top bar: prototype title and meta, variant and snapshot switchers, light/dark,
 *     open in new tab, copy link
 *   - width bar: Phone / Tablet / Laptop / Desktop / Full presets, the current width
 *     (editable) and the scale when the frame is scaled to fit
 */
import { icons } from './icons.js';
import { clampWidth } from './state.js';
import { copyText, escapeHtml, STATUS_LABELS } from './util.js';

export const WIDTH_PRESETS = [
  { id: 'phone', label: 'Phone', width: 390, icon: icons.phone },
  { id: 'tablet', label: 'Tablet', width: 768, icon: icons.tablet },
  { id: 'laptop', label: 'Laptop', width: 1280, icon: icons.laptop },
  { id: 'desktop', label: 'Desktop', width: 1440, icon: icons.desktop },
  { id: 'full', label: 'Full', width: null, icon: icons.full },
];

export function createTopBar(host, { onChange, onToggleSidebar }) {
  host.classList.add('pv-topbar');
  host.innerHTML = `
    <button type="button" class="pv-icon-button" data-action="sidebar" aria-label="Toggle prototype list" title="Toggle prototype list">${icons.sidebar}</button>
    <div class="pv-heading">
      <h1 class="pv-title"></h1>
      <p class="pv-meta"></p>
    </div>
    <div class="pv-controls">
      <div class="pv-field" data-role="variant" hidden>
        <span class="pv-field-label" id="pv-variant-label">Variant</span>
        <div class="pv-segmented" role="radiogroup" aria-labelledby="pv-variant-label"></div>
      </div>
      <label class="pv-field" data-role="snapshot" hidden>
        <span class="pv-field-label">Version</span>
        <select></select>
      </label>
      <span class="pv-divider" aria-hidden="true"></span>
      <button type="button" class="pv-icon-button" data-action="scheme" aria-pressed="false"></button>
      <a class="pv-icon-button" data-action="open" target="_blank" rel="noopener" aria-label="Open prototype in a new tab" title="Open prototype in a new tab">${icons.external}</a>
      <button type="button" class="pv-button" data-action="copy" title="Copy a link to this exact view">${icons.link}<span>Copy link</span></button>
    </div>`;
  const $ = (s) => host.querySelector(s);
  const variantField = $('[data-role=variant]');
  const variantGroup = variantField.querySelector('.pv-segmented');
  const snapshotField = $('[data-role=snapshot]');
  const snapshotSelect = snapshotField.querySelector('select');
  const schemeButton = $('[data-action=scheme]');
  const copyButton = $('[data-action=copy]');
  let state = null;

  $('[data-action=sidebar]').addEventListener('click', onToggleSidebar);
  variantGroup.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) onChange({ variant: b.dataset.id });
  });
  snapshotSelect.addEventListener('change', () => onChange({ snapshot: snapshotSelect.value || null }));
  schemeButton.addEventListener('click', () => onChange({ scheme: state.scheme === 'dark' ? 'light' : 'dark' }, { replace: true }));
  copyButton.addEventListener('click', async () => {
    const ok = await copyText(location.href);
    const label = copyButton.querySelector('span');
    copyButton.classList.toggle('pv-done', ok);
    label.textContent = ok ? 'Copied' : 'Copy failed';
    copyButton.firstElementChild.outerHTML = ok ? icons.check : icons.link;
    clearTimeout(copyButton._t);
    copyButton._t = setTimeout(() => {
      copyButton.classList.remove('pv-done');
      label.textContent = 'Copy link';
      copyButton.firstElementChild.outerHTML = icons.link;
    }, 1800);
  });

  return {
    /** @param view resolved view: { proto, variant, snapshot, frameUrl } */
    render(s, view) {
      state = s;
      const { proto } = view;
      $('.pv-title').textContent = proto ? proto.title : 'Prototypes';
      $('.pv-meta').innerHTML = proto
        ? [
            escapeHtml(proto.area),
            `<span class="pv-status" data-status="${escapeHtml(proto.status)}">${STATUS_LABELS[proto.status] ?? escapeHtml(proto.status)}</span>`,
            escapeHtml(proto.theme),
            proto.version ? `<span title="${escapeHtml(proto.version)}">${escapeHtml(proto.version.slice(0, 7))}</span>` : '',
            proto.updated ? `updated ${escapeHtml(proto.updated.slice(0, 10))}` : '',
          ].filter(Boolean).join('<span aria-hidden="true"> · </span>')
        : '';

      const variants = proto?.variants ?? [];
      variantField.hidden = variants.length < 2;
      variantGroup.innerHTML = variants
        .map((v) => `<button type="button" role="radio" data-id="${escapeHtml(v.id)}" aria-checked="${v.id === view.variant}" title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</button>`)
        .join('');

      const snaps = proto?.snapshots ?? [];
      snapshotField.hidden = !snaps.length;
      snapshotSelect.innerHTML = [`<option value="">Current</option>`, ...snaps.map((sn) => `<option value="${escapeHtml(sn.id)}">${escapeHtml(sn.id)} – ${escapeHtml(sn.label ?? '')}</option>`)].join('');
      snapshotSelect.value = view.snapshot ?? '';

      const dark = s.scheme === 'dark';
      schemeButton.innerHTML = dark ? icons.moon : icons.sun;
      schemeButton.setAttribute('aria-pressed', String(dark));
      schemeButton.setAttribute('aria-label', dark ? 'Dark theme (switch to light)' : 'Light theme (switch to dark)');
      schemeButton.title = dark ? 'Dark – switch to light' : 'Light – switch to dark';

      const open = $('[data-action=open]');
      open.toggleAttribute('hidden', !view.frameUrl);
      if (view.frameUrl) open.href = view.frameUrl;
      copyButton.disabled = !proto;
    },
  };
}

export function createWidthBar(host, { onChange }) {
  host.classList.add('pv-widthbar');
  host.innerHTML = `
    <div class="pv-segmented" role="radiogroup" aria-label="Screen width">
      ${WIDTH_PRESETS.map((p) => `<button type="button" role="radio" data-id="${p.id}" aria-checked="false" title="${p.label}${p.width ? ` (${p.width}px)` : ''}">${p.icon}<span>${p.label}</span></button>`).join('')}
    </div>
    <div class="pv-size">
      <input type="number" min="320" max="2560" step="1" aria-label="Width in pixels" />
      <span class="pv-size-rest"></span>
    </div>`;
  const group = host.querySelector('.pv-segmented');
  const input = host.querySelector('input');
  const rest = host.querySelector('.pv-size-rest');
  let width = null;

  group.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) onChange(WIDTH_PRESETS.find((p) => p.id === b.dataset.id).width);
  });
  // While the user is typing a width, don't overwrite the field.
  let editing = false;
  input.addEventListener('input', () => { editing = true; });
  input.addEventListener('blur', () => { editing = false; });
  input.addEventListener('change', () => {
    editing = false;
    const v = Number.parseInt(input.value, 10);
    if (Number.isFinite(v)) onChange(clampWidth(v));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Let the number input step, then apply on the next tick.
      setTimeout(() => input.dispatchEvent(new Event('change')));
    }
  });

  return {
    setWidth(w) {
      width = w;
      for (const b of group.querySelectorAll('button')) {
        const preset = WIDTH_PRESETS.find((p) => p.id === b.dataset.id);
        b.setAttribute('aria-checked', String(preset.width === w));
      }
    },
    /** Shows the rendered size: the width (editable), height, and scale if < 100%. */
    setLayout({ width: w, height, scale }) {
      if (!editing) input.value = String(w);
      rest.textContent = `× ${height} px${scale < 0.999 ? ` · ${Math.round(scale * 100)}%` : ''}${width === null ? ' · full' : ''}`;
    },
  };
}
