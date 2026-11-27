/**
 * Prototype list (docs/SPEC.md §5.1): grouped by area, searchable (title, area,
 * description), status badges, archived prototypes hidden by default.
 * Items are plain links to the deep-link hash, so middle-click and copy work.
 */
import { icons } from './icons.js';
import { formatHash } from './state.js';
import { escapeHtml, STATUS_LABELS } from './util.js';

export function createSidebar(host, { prototypes }) {
  host.classList.add('pv-sidebar');
  const archivedCount = prototypes.filter((p) => p.status === 'archived').length;
  host.innerHTML = `
    <label class="pv-search">
      ${icons.search}
      <input type="search" placeholder="Search prototypes" aria-label="Search prototypes" autocomplete="off" />
    </label>
    <nav class="pv-list" aria-label="Prototypes"></nav>
    <label class="pv-archived" ${archivedCount ? '' : 'hidden'}>
      <input type="checkbox" /> Show archived (${archivedCount})
    </label>`;
  const input = host.querySelector('input[type=search]');
  const list = host.querySelector('.pv-list');
  const archivedToggle = host.querySelector('.pv-archived input');
  let lastState = null;
  let counts = {};

  input.addEventListener('input', () => render(lastState));
  archivedToggle.addEventListener('change', () => render(lastState));

  function render(state) {
    lastState = state;
    const q = input.value.trim().toLowerCase();
    const visible = prototypes.filter((p) => {
      if (p.status === 'archived' && !archivedToggle.checked && p.slug !== state.slug) return false;
      if (!q) return true;
      return [p.title, p.area, p.description].some((t) => t?.toLowerCase().includes(q));
    });
    const areas = new Map();
    for (const p of visible) {
      const area = p.area || 'Other';
      if (!areas.has(area)) areas.set(area, []);
      areas.get(area).push(p);
    }
    const groups = [...areas.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (!groups.length) {
      list.innerHTML = `<p class="pv-empty">${q ? 'No prototypes match your search.' : 'No prototypes yet.'}</p>`;
      return;
    }
    list.innerHTML = groups
      .map(([area, items]) => `
        <section class="pv-group">
          <h2>${escapeHtml(area)}</h2>
          <ul>
            ${items
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((p) => {
                const href = formatHash({ ...state, page: 'prototype', slug: p.slug, variant: null, snapshot: null, extra: {} });
                const current = state.page !== 'setup' && p.slug === state.slug;
                const extras = [
                  p.variants?.length > 1 ? `${p.variants.length} variants` : '',
                  p.snapshots?.length ? `${p.snapshots.length} snapshot${p.snapshots.length > 1 ? 's' : ''}` : '',
                ].filter(Boolean).join(' · ');
                return `
                  <li>
                    <a href="${href}" class="pv-item" data-slug="${escapeHtml(p.slug)}" ${current ? 'aria-current="page"' : ''}
                       title="${escapeHtml(p.description ?? '')}">
                      <span class="pv-item-title">${escapeHtml(p.title)}</span>
                      <span class="pv-item-meta">
                        <span class="pv-status" data-status="${escapeHtml(p.status)}">${STATUS_LABELS[p.status] ?? escapeHtml(p.status)}</span>
                        ${extras ? `<span>${extras}</span>` : ''}
                        ${counts[p.slug] ? `<span class="pv-item-comments" title="${counts[p.slug]} open comment${counts[p.slug] === 1 ? '' : 's'}">${icons.comment}${counts[p.slug]}</span>` : ''}
                      </span>
                    </a>
                  </li>`;
              })
              .join('')}
          </ul>
        </section>`)
      .join('');
  }

  return {
    render,
    focusSearch: () => input.focus(),
    /** Open comment threads per prototype slug (§5.1); {} when comments are off. */
    setCounts(c) {
      counts = c ?? {};
      if (lastState) render(lastState);
    },
  };
}
