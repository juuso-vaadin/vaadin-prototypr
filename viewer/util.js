export const STATUS_LABELS = { draft: 'Draft', 'in-review': 'In review', approved: 'Approved', archived: 'Archived' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Copies text to the clipboard, with a fallback for non-secure contexts. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Reads/writes a per-viewer preference; storage can be unavailable. */
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`proto-viewer:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`proto-viewer:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
