/**
 * "This browser only" backend: comments in localStorage. For trying comments before
 * a database is set up, and for tests. Nobody else sees these comments.
 */
import { siteStorage, uuid } from '../../util.js';

const KEY = 'local-comments';

export function createLocalBackend() {
  const ME = 'local-me';
  const load = () => siteStorage.get(KEY, { userId: null, threads: [] });
  const save = (db) => siteStorage.set(KEY, db);
  const db0 = load();
  if (!db0.userId) {
    db0.userId = uuid();
    save(db0);
  }
  const now = () => new Date().toISOString();
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function update(fn) {
    const db = load();
    const result = fn(db);
    save(db);
    return clone(result ?? null);
  }
  function findComment(db, id) {
    for (const t of db.threads) {
      const i = t.comments.findIndex((c) => c.id === id);
      if (i >= 0) return { t, i };
    }
    throw new Error('Comment not found');
  }

  const backend = {
    kind: 'local',
    label: 'This browser only',
    shared: false,
    needsPassword: false,
    userId: db0.userId,
    async connect() {
      const me = siteStorage.get(ME);
      const project = { slug: 'local', name: 'This browser only' };
      return me ? { status: 'ready', project, me } : { status: 'signed-out', project };
    },
    async signIn({ name, email }) {
      if (!name?.trim()) return { ok: false, reason: 'invalid-name' };
      const me = { name: name.trim(), email: email?.trim() || null };
      siteStorage.set(ME, me);
      return { ok: true, project: { slug: 'local', name: 'This browser only' }, me };
    },
    async signOut() {
      siteStorage.set(ME, null);
    },
    async setName({ name, email }) {
      if (!name?.trim()) return false;
      siteStorage.set(ME, { name: name.trim(), email: email?.trim() || null });
      return true;
    },
    async listThreads(slug) {
      return clone(load().threads.filter((t) => t.prototypeSlug === slug));
    },
    async openCounts() {
      const counts = {};
      for (const t of load().threads) if (t.status === 'open' && t.comments.length) counts[t.prototypeSlug] = (counts[t.prototypeSlug] ?? 0) + 1;
      return counts;
    },
    async createThread(f, body) {
      const me = siteStorage.get(ME);
      return update((db) => {
        const t = {
          id: uuid(), ...f, status: 'open', createdBy: db.userId, createdAt: now(), resolvedAt: null, resolvedBy: null, comments: [],
        };
        t.comments.push({ id: uuid(), threadId: t.id, authorId: db.userId, authorName: me.name, authorEmail: me.email, body, createdAt: now(), editedAt: null });
        db.threads.push(t);
        return t;
      });
    },
    async addComment(threadId, body) {
      const me = siteStorage.get(ME);
      return update((db) => {
        const t = db.threads.find((x) => x.id === threadId);
        if (!t) throw new Error('Thread not found');
        const comment = { id: uuid(), threadId, authorId: db.userId, authorName: me.name, authorEmail: me.email, body, createdAt: now(), editedAt: null };
        t.comments.push(comment);
        return comment;
      });
    },
    async editComment(id, body) {
      update((db) => {
        const { t, i } = findComment(db, id);
        if (t.comments[i].authorId !== db.userId) throw new Error('You can only edit your own comments');
        Object.assign(t.comments[i], { body, editedAt: now() });
      });
    },
    async deleteComment(id) {
      update((db) => {
        const { t, i } = findComment(db, id);
        if (t.comments[i].authorId !== db.userId) throw new Error('You can only delete your own comments');
        t.comments.splice(i, 1);
      });
    },
    async setStatus(threadId, status) {
      update((db) => {
        const t = db.threads.find((x) => x.id === threadId);
        Object.assign(t, { status, resolvedAt: status === 'resolved' ? now() : null, resolvedBy: status === 'resolved' ? db.userId : null });
      });
    },
  };
  return backend;
}
