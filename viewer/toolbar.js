/**
 * Viewer controls (SPEC.md §5.1):
 *   - top bar: prototype title and meta, variant and snapshot switchers, light/dark,
 *     open in new tab, copy link
 *   - screen-size dropdown in the top bar: Full (default), Phone, Tablet, and a
 *     custom width when one is dragged or comes from a deep link
 */
import { icons } from './icons.js';
import { copyText, escapeHtml, STATUS_LABELS } from './util.js';

// The viewer is used on desktop: Full is the default, and resizing the browser
// covers the in-between sizes. Phone and Tablet are the sizes a desktop can't show.
export const WIDTH_PRESETS = [
  { id: 'full', label: 'Full', width: null, icon: icons.full },
  { id: 'phone', label: 'Phone', width: 390, icon: icons.phone },
  { id: 'tablet', label: 'Tablet', width: 768, icon: icons.tablet },
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
      <div data-role="size"></div>
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

/**
 * Screen-size dropdown in the top bar. Full (fit the window) is the default; Phone
 * and Tablet are offered because the viewer is used on desktop, where resizing the
 * browser covers the wider sizes. A custom width (dragged on the stage, or from a
 * deep link) shows as its own checked entry.
 */
export function createSizeMenu(host, { onChange }) {
  host.classList.add('pv-menu');
  host.innerHTML = `
    <button type="button" class="pv-button pv-menu-button" aria-haspopup="menu" aria-expanded="false" title="Screen size">
      <span class="pv-menu-icon"></span><span class="pv-menu-label"></span>${icons.chevron}
    </button>
    <div class="pv-menu-popup" role="menu" aria-label="Screen size" hidden>
      ${WIDTH_PRESETS.map((p) => `
        <button type="button" role="menuitemradio" data-id="${p.id}" aria-checked="false">
          ${p.icon}<span class="pv-menu-item-label">${p.label}</span><span class="pv-menu-item-hint">${p.width ? `${p.width} px` : 'fit window'}</span>
        </button>`).join('')}
      <button type="button" role="menuitemradio" data-id="custom" aria-checked="true" hidden>
        ${icons.resize}<span class="pv-menu-item-label">Custom</span><span class="pv-menu-item-hint"></span>
      </button>
      <div class="pv-menu-footer">Drag the frame's edges for any other width.</div>
    </div>`;
  const button = host.querySelector('.pv-menu-button');
  const popup = host.querySelector('.pv-menu-popup');
  const items = () => [...popup.querySelectorAll('[role=menuitemradio]:not([hidden])')];
  const custom = popup.querySelector('[data-id=custom]');
  let width = null;
  let layout = { width: 0, height: 0, scale: 1 };

  const open = (focusFirst) => {
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const target = items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0];
    if (focusFirst) target.focus();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
  };
  const close = (refocus) => {
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    if (refocus) button.focus();
  };
  const outside = (e) => { if (!host.contains(e.target)) close(false); };
  const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };

  button.addEventListener('click', () => (popup.hidden ? open(false) : close(false)));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); }
  });
  popup.addEventListener('click', (e) => {
    const item = e.target.closest('[role=menuitemradio]');
    if (!item) return;
    close(true);
    if (item.dataset.id !== 'custom') onChange(WIDTH_PRESETS.find((p) => p.id === item.dataset.id).width);
  });
  popup.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Tab') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
  });

  function update() {
    const preset = WIDTH_PRESETS.find((p) => p.width === width);
    for (const item of popup.querySelectorAll('[data-id]:not([data-id=custom])')) {
      item.setAttribute('aria-checked', String(item.dataset.id === preset?.id));
    }
    custom.hidden = !!preset;
    custom.querySelector('.pv-menu-item-hint').textContent = `${width} px`;
    const scale = layout.scale < 0.999 ? ` · ${Math.round(layout.scale * 100)}%` : '';
    host.querySelector('.pv-menu-icon').innerHTML = (preset ?? { icon: icons.resize }).icon;
    host.querySelector('.pv-menu-label').textContent = preset?.width === null ? 'Full' : `${preset?.label ?? 'Custom'} ${width} px${scale}`;
    button.title = `Screen size: ${layout.width} × ${layout.height} px${scale}`;
    button.setAttribute('aria-label', button.title);
  }

  return {
    setWidth(w) { width = w; update(); },
    /** The rendered frame size and scale (shown in the button's tooltip and label). */
    setLayout(info) { layout = info; update(); },
  };
}
