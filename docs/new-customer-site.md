# Setting up a new customer site

Each customer gets their own repository, made from this template, and their own
site on GitHub Pages (SPEC.md C3). Per customer this takes about 10 minutes, all in
the browser.

## Once per organisation

Do these once; every customer site made afterwards benefits.

1. **Make this repository a template.** Settings → General → tick **Template
   repository**.
2. **Comment storage (optional).** If customers should be able to comment, set up the
   shared Supabase project once: open the template's own site (or run it locally,
   `npm run serve`) at `#/setup` and follow **step 1** there. Then put the Supabase
   **project URL** and **publishable key** into the template's `site.config.json`
   under `comments.supabase` and commit. Leave `comments.project` empty: each
   customer site gets its own project id. From then on new sites only need a
   password (below).
3. **Claude Code access.** For people to build prototypes with Claude Code on the web,
   the Claude GitHub app needs access to the organisation's customer repositories
   (or to all of them).

## Per customer (about 10 minutes)

| Step | Where | Time |
|---|---|---|
| 1. Create the repository | GitHub | 1 min |
| 2. Turn on GitHub Pages | Repository settings | 1 min |
| 3. Run **Set up site** | Actions | 3 min |
| 4. Comment password | The new site, `#/setup` + Supabase SQL editor | 4 min |
| 5. Share | Email / chat | 1 min |

### 1. Create the repository
On this repository's GitHub page: **Use this template → Create a new repository**.
Pick the organisation as owner and a name such as `acme-prototypes`. The site will be
at `https://<owner>.github.io/<name>/`.

*Private or public?* Private keeps the prototype source and history out of view, but
GitHub Pages for a private repository needs a paid GitHub plan (Team or Enterprise).
Either way the **site itself is public** to anyone who has its address; only comments
are protected (SPEC.md §2).

GitHub may try to deploy right away and show a failed "Deploy to GitHub Pages" run.
That's harmless: Pages isn't turned on yet.

### 2. Turn on GitHub Pages
In the new repository: **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

If the organisation limits workflow permissions, also check **Settings → Actions →
General → Workflow permissions: Read and write permissions** (step 3 commits to the
repository).

### 3. Run "Set up site"
**Actions → Set up site → Run workflow**, then fill in:

- **Customer name**: shown in the viewer, e.g. `ACME Corp`.
- **Theme**: the Vaadin theme for this customer's prototypes: `aura` (Vaadin's
  current default), `lumo`, or `base` (unstyled base styles). New prototypes follow it.
- **Comments**: `on` or `off`.
- **Comment project id**: leave empty to use the customer name (`acme-corp`).
- **Keep example prototypes**: normally off.

It removes the template's example prototypes, writes `site.config.json` and a short
README for the customer, commits, and starts the deployment. Its summary page links to
the site. A minute or two later the site shows *No prototypes yet*.

*Without Actions:* clone the repository, run
`node scripts/init-site.mjs --customer "ACME Corp" --theme aura`, then commit and push.

### 4. Comment password (if comments are on)
Open the new site at `#/setup` (e.g. `https://<owner>.github.io/acme-prototypes/#/setup`):

1. In **step 2**, check the project id (it's filled in from the site) and press
   **Generate password**. Copy the password into your password manager now.
2. Copy the SQL and run it in the Supabase **SQL editor**. The database keeps only a
   bcrypt hash of the password.
3. In **step 3**, enter the password and press **Check connection**. All lines should
   be ticked.

If step 3 says the publishable key or URL is missing, the organisation-wide
Supabase settings (above) haven't been added to the template yet. Add them to this
site's `site.config.json` too.

### 5. Share
Send the customer the **site address**, and the **comment password** through a separate
channel. People open **Comments**, sign in with the password and their name, and can
start pinning comments.

## Then: the first prototype
Open the customer repository in Claude Code (on the web or locally) and describe what
to build, e.g. *"Create a prototype of the order list with bulk actions, in two
variants."* Claude follows `CLAUDE.md`, checks its work in the viewer, and opens a
pull request or pushes a branch. Merge it to `main`, and the prototype appears on the
site.

## Troubleshooting
- **The site shows 404.** The first deployment hasn't finished, or Pages isn't set to
  *GitHub Actions* (step 2). Re-run **Actions → Deploy to GitHub Pages**.
- **"Set up site" fails at Commit with a permission error.** Workflow permissions are
  read-only (step 2, second paragraph).
- **"Set up site" says the site is already set up.** It runs once. To change the theme
  or comments later, edit `site.config.json`.
- **"Set up site" is skipped.** It never runs in the template repository itself.
- **Comments say "Comments aren't available".** `comments.project` in `site.config.json`
  doesn't match the project id used in step 4.
