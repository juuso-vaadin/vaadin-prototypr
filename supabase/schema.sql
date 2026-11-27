-- Prototype viewer comments: tables, access rules (RLS) and functions (SPEC.md §6).
--
-- Run this in the Supabase SQL editor of the shared comments project. It is safe to
-- run again: it creates what is missing and replaces functions, triggers and policies.
-- One Supabase project serves every customer site; each customer is a row in
-- public.projects with its own comment password.
--
-- How access works
--   - Viewing prototypes needs nothing. Comments need membership.
--   - Visitors get an anonymous Supabase identity (Auth → "Allow anonymous sign-ins"),
--     so every request has a user id (auth.uid()) and the "authenticated" role.
--   - To comment, a visitor signs in once with the customer's comment password and
--     their name: public.join_project() checks the password against a bcrypt hash
--     (failed attempts are rate-limited) and adds them to public.members.
--   - Every access rule below asks: is this user a current member of the project?
--     Comment author names come from the membership, not from the browser.
--   - Changing a project's password (and bumping password_version) signs everyone
--     out of that project; they need the new password.
--   - The "anon" role (no Supabase session) gets no access at all.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name             text not null,
  password_hash    text not null check (password_hash like '$2%'),  -- bcrypt, see "Adding a customer"
  password_version integer not null default 1,
  created_at       timestamptz not null default now()
);

create table if not exists public.members (
  project_id       uuid not null references public.projects (id) on delete cascade,
  user_id          uuid not null,
  display_name     text not null check (length(btrim(display_name)) between 1 and 80),
  email            text check (length(email) <= 200),
  password_version integer not null,
  joined_at        timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.sign_in_attempts (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null,
  succeeded  boolean not null,
  at         timestamptz not null default now()
);
create index if not exists sign_in_attempts_project_at_idx on public.sign_in_attempts (project_id, at);
create index if not exists sign_in_attempts_user_at_idx on public.sign_in_attempts (user_id, at);

create table if not exists public.threads (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  prototype_slug text not null check (length(prototype_slug) between 1 and 200),
  variant        text check (length(variant) <= 100),
  snapshot       text check (length(snapshot) <= 100),
  version_sha    text check (length(version_sha) <= 100),
  anchor         jsonb not null,
  viewport       jsonb,
  theme          text check (theme in ('light', 'dark')),
  status         text not null default 'open' check (status in ('open', 'resolved')),
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid
);
create index if not exists threads_project_prototype_idx on public.threads (project_id, prototype_slug);

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.threads (id) on delete cascade,
  author_id    uuid not null default auth.uid(),
  author_name  text not null default '' check (length(author_name) <= 80),
  author_email text check (length(author_email) <= 200),
  body         text not null check (length(btrim(body)) between 1 and 5000),
  created_at   timestamptz not null default now(),
  edited_at    timestamptz
);
create index if not exists comments_thread_idx on public.comments (thread_id);

-- ---------------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------------

-- Is the current user a member of the project with its current password?
create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.projects p on p.id = m.project_id
    where m.project_id = p_project
      and m.user_id = auth.uid()
      and m.password_version = p.password_version
  )
$$;

-- Public facts about a project, so the viewer can say "Sign in to comment on <name>".
create or replace function public.project_public(p_slug text)
returns table (slug text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug, p.name from public.projects p where p.slug = p_slug
$$;

-- The current user's membership of a project, if valid.
create or replace function public.my_membership(p_slug text)
returns table (project_id uuid, project_name text, display_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, m.display_name, m.email
  from public.projects p
  join public.members m on m.project_id = p.id and m.user_id = auth.uid()
  where p.slug = p_slug and m.password_version = p.password_version
$$;

-- Sign in to a project with its comment password. Returns
--   { ok: true, project: { id, slug, name } }  or  { ok: false, reason: ... }
-- reasons: not-signed-in, unknown-project, invalid-name, wrong-password, too-many-attempts
-- Limits: 5 failed attempts per user and 50 per project in 15 minutes.
create or replace function public.join_project(p_slug text, p_password text, p_name text, p_email text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_project public.projects;
  v_fails_user integer;
  v_fails_project integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not-signed-in');
  end if;
  select * into v_project from public.projects where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-project');
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or length(coalesce(p_email, '')) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-name');
  end if;

  delete from public.sign_in_attempts where at < now() - interval '1 day';
  select count(*) into v_fails_user from public.sign_in_attempts
    where user_id = v_user and not succeeded and at > now() - interval '15 minutes';
  select count(*) into v_fails_project from public.sign_in_attempts
    where project_id = v_project.id and not succeeded and at > now() - interval '15 minutes';
  if v_fails_user >= 5 or v_fails_project >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'too-many-attempts');
  end if;

  if v_project.password_hash <> extensions.crypt(coalesce(p_password, ''), v_project.password_hash) then
    insert into public.sign_in_attempts (project_id, user_id, succeeded) values (v_project.id, v_user, false);
    return jsonb_build_object('ok', false, 'reason', 'wrong-password');
  end if;

  insert into public.sign_in_attempts (project_id, user_id, succeeded) values (v_project.id, v_user, true);
  insert into public.members (project_id, user_id, display_name, email, password_version)
  values (v_project.id, v_user, btrim(p_name), nullif(btrim(coalesce(p_email, '')), ''), v_project.password_version)
  on conflict (project_id, user_id) do update
    set display_name = excluded.display_name, email = excluded.email,
        password_version = excluded.password_version, joined_at = now();
  return jsonb_build_object('ok', true, 'project', jsonb_build_object('id', v_project.id, 'slug', v_project.slug, 'name', v_project.name));
end
$$;

-- Change the name (and email) the current member comments under. New comments only.
create or replace function public.set_my_name(p_slug text, p_name text, p_email text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    return false;
  end if;
  update public.members m
     set display_name = btrim(p_name), email = nullif(btrim(coalesce(p_email, '')), '')
    from public.projects p
   where p.slug = p_slug and m.project_id = p.id and m.user_id = auth.uid();
  return found;
end
$$;

-- Sign out of a project (removes the membership; comments stay).
create or replace function public.leave_project(p_slug text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.members m using public.projects p
  where p.slug = p_slug and m.project_id = p.id and m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------------
-- Triggers: server-set fields
-- ---------------------------------------------------------------------------------

create or replace function public.threads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.status := 'open';
    new.resolved_at := null;
    new.resolved_by := null;
  elsif new.status is distinct from old.status then
    new.resolved_at := case when new.status = 'resolved' then now() end;
    new.resolved_by := case when new.status = 'resolved' then auth.uid() end;
  end if;
  return new;
end
$$;
drop trigger if exists threads_before_write on public.threads;
create trigger threads_before_write before insert or update on public.threads
  for each row execute function public.threads_before_write();

-- The author's name and email come from their membership, never from the browser.
create or replace function public.comments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
    new.edited_at := null;
    select m.display_name, m.email into new.author_name, new.author_email
      from public.threads t
      join public.members m on m.project_id = t.project_id and m.user_id = auth.uid()
     where t.id = new.thread_id;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists comments_before_write on public.comments;
create trigger comments_before_write before insert or update on public.comments
  for each row execute function public.comments_before_write();

-- ---------------------------------------------------------------------------------
-- Privileges: signed-in (incl. anonymous) users only, only the columns they may change
-- ---------------------------------------------------------------------------------

revoke all on public.projects, public.members, public.sign_in_attempts, public.threads, public.comments from anon, authenticated;
grant select, insert on public.threads to authenticated;
grant update (status) on public.threads to authenticated;
grant select, delete on public.comments to authenticated;
grant insert (thread_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.project_public(text) from public, anon;
revoke all on function public.my_membership(text) from public, anon;
revoke all on function public.join_project(text, text, text, text) from public, anon;
revoke all on function public.set_my_name(text, text, text) from public, anon;
revoke all on function public.leave_project(text) from public, anon;
revoke all on function public.threads_before_write() from public, anon, authenticated;
revoke all on function public.comments_before_write() from public, anon, authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.project_public(text) to authenticated;
grant execute on function public.my_membership(text) to authenticated;
grant execute on function public.join_project(text, text, text, text) to authenticated;
grant execute on function public.set_my_name(text, text, text) to authenticated;
grant execute on function public.leave_project(text) to authenticated;

-- ---------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------

alter table public.projects enable row level security;          -- no policies: no direct access
alter table public.members enable row level security;           -- no policies: functions only
alter table public.sign_in_attempts enable row level security;  -- no policies: functions only
alter table public.threads enable row level security;
alter table public.comments enable row level security;

-- Policies from the earlier share-token version of this schema.
drop policy if exists "threads: read in project" on public.threads;
drop policy if exists "threads: create in project" on public.threads;
drop policy if exists "threads: resolve in project" on public.threads;
drop policy if exists "comments: read in project" on public.comments;
drop policy if exists "comments: write in project" on public.comments;
drop policy if exists "comments: edit own" on public.comments;
drop policy if exists "comments: delete own" on public.comments;

drop policy if exists "threads: members read" on public.threads;
create policy "threads: members read" on public.threads
  for select to authenticated
  using (public.is_member(project_id));

drop policy if exists "threads: members create" on public.threads;
create policy "threads: members create" on public.threads
  for insert to authenticated
  with check (public.is_member(project_id) and created_by = auth.uid());

-- Any member can resolve or reopen a thread (only `status` is granted).
drop policy if exists "threads: members resolve" on public.threads;
create policy "threads: members resolve" on public.threads
  for update to authenticated
  using (public.is_member(project_id))
  with check (public.is_member(project_id));

drop policy if exists "comments: members read" on public.comments;
create policy "comments: members read" on public.comments
  for select to authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id and public.is_member(t.project_id)));

drop policy if exists "comments: members write" on public.comments;
create policy "comments: members write" on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.threads t where t.id = thread_id and public.is_member(t.project_id))
  );

-- Members edit (only `body` is granted) and delete their own comments.
drop policy if exists "comments: edit own" on public.comments;
create policy "comments: edit own" on public.comments
  for update to authenticated
  using (author_id = auth.uid() and exists (select 1 from public.threads t where t.id = thread_id and public.is_member(t.project_id)))
  with check (author_id = auth.uid());

drop policy if exists "comments: delete own" on public.comments;
create policy "comments: delete own" on public.comments
  for delete to authenticated
  using (author_id = auth.uid() and exists (select 1 from public.threads t where t.id = thread_id and public.is_member(t.project_id)));

-- ---------------------------------------------------------------------------------
-- Adding a customer (once per customer site; the viewer's setup page at #/setup
-- generates this with a strong password):
--
--   insert into public.projects (slug, name, password_hash)
--   values ('acme', 'ACME Corp', extensions.crypt('<comment password>', extensions.gen_salt('bf', 10)));
--
-- Changing the password (signs everyone out of that project):
--
--   update public.projects
--      set password_hash = extensions.crypt('<new password>', extensions.gen_salt('bf', 10)),
--          password_version = password_version + 1
--    where slug = 'acme';
-- ---------------------------------------------------------------------------------
