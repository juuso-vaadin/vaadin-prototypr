/**
 * Comment storage backends (SPEC.md §6).
 *
 * The viewer talks to comment storage only through this interface, so another
 * database can be added as one more file here. A backend is created with
 * `create(config)` and has:
 *
 *   kind, label            e.g. 'supabase', 'Supabase'
 *   shared                 true if other people see the comments (false for 'local')
 *   needsPassword          true if signing in needs the site's comment password
 *   userId                 the current commenter's id (set by connect / signIn)
 *   connect()              → { status: 'ready', project: { slug, name }, me: { name, email } }
 *                            | { status: 'signed-out', project: { slug, name } }
 *                            | { status: 'unknown-project' } | { status: 'error', message }
 *   signIn({ password, name, email })
 *                          → { ok: true, project, me } | { ok: false, reason }
 *                            reasons: wrong-password, too-many-attempts, invalid-name, unknown-project
 *   signOut()
 *   setName({ name, email }) → boolean (applies to new comments)
 *   listThreads(slug)      → Thread[] for one prototype, each with its comments
 *   openCounts()           → { [prototypeSlug]: number of open threads }
 *   createThread(fields, body) → Thread   (the author is the signed-in member)
 *   addComment(threadId, body) → Comment
 *   editComment(commentId, body)
 *   deleteComment(commentId)
 *   setStatus(threadId, 'open' | 'resolved')
 *
 * Thread:  { id, prototypeSlug, variant, snapshot, versionSha, anchor, viewport, theme,
 *            status, createdBy, createdAt, resolvedAt, resolvedBy, comments: Comment[] }
 * Comment: { id, threadId, authorId, authorName, authorEmail, body, createdAt, editedAt }
 *
 * Requirements for a shared backend: viewing prototypes needs nothing, but reading or
 * writing comments needs membership of the customer's project (phase 1: the comment
 * password + a display name; later e.g. GitHub sign-in). The author name comes from the
 * membership, not from each request. Members edit and delete only their own comments;
 * any member can resolve and reopen threads. Customers never see each other's data.
 */
import { createSupabaseBackend } from './supabase.js';
import { createLocalBackend } from './local.js';

export const BACKENDS = {
  supabase: { create: createSupabaseBackend, isConfigured: (c) => !!(c?.project && c?.supabase?.url && c?.supabase?.publishableKey) },
  local: { create: createLocalBackend, isConfigured: () => true },
};
