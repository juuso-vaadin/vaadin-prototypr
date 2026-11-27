/**
 * Supabase backend: plain fetch against Supabase Auth and PostgREST, no SDK
 * (the viewer has no dependencies). Schema and access rules: supabase/schema.sql.
 *
 *   - Identity: anonymous sign-in (POST /auth/v1/signup with no email). The session is
 *     kept in localStorage per Supabase project and refreshed before it expires.
 *   - Access: membership of the customer's project (site.config.json → comments.project),
 *     gained with the comment password through rpc/join_project. Row-level security
 *     lets only members read and write comments.
 */

const SESSION_KEY = (url) => `proto-viewer:supabase-session:${url}`;

export function createSupabaseBackend(config) {
  const url = config.supabase.url.replace(/\/+$/, '');
  const key = config.supabase.publishableKey;
  const slug = config.project;
  let session = readSession();
  let projectId = null;

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY(url)) ?? 'null');
    } catch {
      return null;
    }
  }
  function saveSession(s) {
    session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600), user_id: s.user?.id ?? session?.user_id } : null;
    try {
      if (session) localStorage.setItem(SESSION_KEY(url), JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY(url));
    } catch {
      /* private mode: session lives only in memory */
    }
  }

  async function authRequest(path, body) {
    const res = await fetch(`${url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(data.msg || data.message || data.error_description || `Sign-in failed (${res.status})`, res.status, data);
    return data;
  }

  async function ensureSession() {
    const now = Math.floor(Date.now() / 1000);
    if (session?.access_token && session.expires_at - now > 60) return session;
    if (session?.refresh_token) {
      try {
        saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
        return session;
      } catch {
        /* fall through to a new anonymous identity */
      }
    }
    saveSession(await authRequest('signup', { data: {} }));
    return session;
  }

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const s = await ensureSession();
    const headers = { apikey: key, Authorization: `Bearer ${s.access_token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new BackendError(data?.message || `Request failed (${res.status})`, res.status, data);
    return data;
  }
  const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: args });

  const backend = {
    kind: 'supabase',
    label: 'Supabase',
    shared: true,
    needsPassword: true,
    userId: session?.user_id ?? null,

    async connect() {
      try {
        await ensureSession();
        backend.userId = session.user_id;
        const [membership] = await rpc('my_membership', { p_slug: slug });
        if (membership) {
          projectId = membership.project_id;
          return { status: 'ready', project: { slug, name: membership.project_name }, me: { name: membership.display_name, email: membership.email } };
        }
        const [project] = await rpc('project_public', { p_slug: slug });
        return project ? { status: 'signed-out', project } : { status: 'unknown-project' };
      } catch (e) {
        return { status: 'error', message: explain(e) };
      }
    },

    async signIn({ password, name, email }) {
      const r = await rpc('join_project', { p_slug: slug, p_password: password, p_name: name, p_email: email || null });
      if (!r?.ok) return { ok: false, reason: r?.reason ?? 'error' };
      projectId = r.project.id;
      return { ok: true, project: { slug: r.project.slug, name: r.project.name }, me: { name: name.trim(), email: email?.trim() || null } };
    },

    async signOut() {
      await rpc('leave_project', { p_slug: slug });
      projectId = null;
    },

    async setName({ name, email }) {
      return !!(await rpc('set_my_name', { p_slug: slug, p_name: name, p_email: email || null }));
    },

    async listThreads(prototypeSlug) {
      const rows = await rest(`threads?select=*,comments(*)&project_id=eq.${projectId}&prototype_slug=eq.${encodeURIComponent(prototypeSlug)}&order=created_at.asc&comments.order=created_at.asc`);
      return rows.map(toThread);
    },

    async openCounts() {
      const rows = await rest(`threads?select=prototype_slug,comments(id)&project_id=eq.${projectId}&status=eq.open&comments.limit=1`);
      const counts = {};
      for (const r of rows) if (r.comments?.length) counts[r.prototype_slug] = (counts[r.prototype_slug] ?? 0) + 1;
      return counts;
    },

    async createThread(f, body) {
      const [row] = await rest('threads', {
        method: 'POST',
        prefer: 'return=representation',
        body: { project_id: projectId, prototype_slug: f.prototypeSlug, variant: f.variant, snapshot: f.snapshot, version_sha: f.versionSha, anchor: f.anchor, viewport: f.viewport, theme: f.theme },
      });
      const thread = toThread({ ...row, comments: [] });
      thread.comments.push(await backend.addComment(thread.id, body));
      return thread;
    },

    async addComment(threadId, body) {
      const [row] = await rest('comments', { method: 'POST', prefer: 'return=representation', body: { thread_id: threadId, body } });
      return toComment(row);
    },

    async editComment(id, body) {
      await rest(`comments?id=eq.${id}`, { method: 'PATCH', body: { body } });
    },

    async deleteComment(id) {
      await rest(`comments?id=eq.${id}`, { method: 'DELETE' });
    },

    async setStatus(threadId, status) {
      await rest(`threads?id=eq.${threadId}`, { method: 'PATCH', body: { status } });
    },
  };
  return backend;
}

export class BackendError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Turns common setup mistakes into something actionable. */
function explain(e) {
  const m = String(e.message ?? e);
  if (/anonymous sign-ins are disabled/i.test(m)) return 'Anonymous sign-ins are turned off in the Supabase project (Authentication settings).';
  if (/relation .* does not exist|Could not find the function|schema cache/i.test(m)) return 'The comment tables are missing or out of date. Run supabase/schema.sql in the Supabase SQL editor.';
  if (/invalid api key|no api key/i.test(m) || e.status === 401) return 'Supabase rejected the publishable key. Check site.config.json.';
  if (e instanceof TypeError) return 'Could not reach Supabase. Check the URL in site.config.json and your connection.';
  return m;
}

function toThread(r) {
  return {
    id: r.id,
    prototypeSlug: r.prototype_slug,
    variant: r.variant,
    snapshot: r.snapshot,
    versionSha: r.version_sha,
    anchor: r.anchor,
    viewport: r.viewport,
    theme: r.theme,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    comments: (r.comments ?? []).map(toComment).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

function toComment(r) {
  return {
    id: r.id,
    threadId: r.thread_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorEmail: r.author_email,
    body: r.body,
    createdAt: r.created_at,
    editedAt: r.edited_at,
  };
}
