# Vaadin Prototype Viewer – Specification (v1)

Status: phase 1. M1, M2, M3 and M5 are built (§10); not yet run against a real Supabase project or a customer site.
Owner: Juuso Kantonen, Vaadin

## 1. Purpose

A per-customer website that collects every HTML prototype made for that customer, lets anyone with the link browse them in one viewer, and lets the people who have the site's comment password leave Figma-style pinned comments on top of the designs.

Prototypes are AI-built HTML stand-ins for Vaadin Flow UIs. They use the real Vaadin web components and a real Vaadin theme (Aura, Lumo or the base styles), and they get translated into Vaadin Flow (Java) code later. Flow components are Java wrappers around the same web components, so the handoff is mostly a direct mapping.

**Background:** read [background-ai-driven-html-prototyping.md](background-ai-driven-html-prototyping.md) first. It's the discussion paper this project comes from: why customers want AI-built prototypes, the role of customer design systems, and the prototyping setups tried so far. This project is the evolution of its **Setup A** (boilerplate repository), adding the sharing, comments and long-lived viewer that Setup A lacked. Where the paper and this spec differ, this spec decides.

How this spec reads two of the paper's principles:
- *Prototypes are throwaway:* each prototype still answers one focused design question. Once it has served its purpose it's **archived** (status `archived`), not deleted, so the site keeps a record.
- *Versioning and branching:* "branching" means trying another design direction. Here that's done with **variants** inside a prototype, not Git branches (C4).

## 2. Constraints and decisions

| # | Decision |
|---|----------|
| C1 | **No Anthropic API usage.** Prototypes are created with Claude Code on the web (or locally) on a Claude subscription. Nothing in this project calls an LLM API, including the CI. |
| C2 | **Hosting is GitHub Pages**, deployed by GitHub Actions from `main`. |
| C3 | **One repository per customer.** It's created from this repository, which is a GitHub template repository, and set up with the **Set up site** action (§7.3). |
| C4 | **No branch-based workflow.** All prototypes live on `main`. Design alternatives live *inside* a prototype (variants). Branches made by Claude Code sessions are just a way to get work merged. |
| C5 | **Prototypes are long-lived.** The site grows over months. Earlier prototypes stay available, and prototypes can come from unrelated parts of the application. |
| C6 | **Same tech stack, pinned.** All prototypes use Vaadin web components and a Vaadin theme, served from the repo (no CDN at runtime). Each prototype records which vendored version it uses, so later upgrades don't break older prototypes. |
| C6b | **Theme-agnostic, one theme per site by convention.** The tooling supports Aura, Lumo and the base styles. A customer site normally uses one theme throughout (`site.config.json` → `defaultTheme`), and new prototypes use the same theme as earlier ones. Mixing themes between prototypes is technically possible but not expected. The viewer doesn't care which theme a prototype uses. |
| C7 | **Comments are a must-have, but optional per site and not public.** Commenting needs no GitHub account, but it does need signing in: phase 1 uses a per-site comment password plus a display name (§6.2); GitHub sign-in is the planned next option. Comments are stored outside GitHub (Supabase, behind a small backend interface). A site without a comment backend works fully as a viewer. |
| C8 | **No Claude artifacts.** Prototypes aren't hosted or viewed through claude.ai. |
| C9 | **Viewer code is kept separate** (`/viewer`), so it can later move into a shared package that all customer repos use (phase 2). |

Known consequence: the prototype pages on GitHub Pages are public to anyone who has the URL (unless the org has GitHub Enterprise Cloud with private Pages). Comments are protected by the comment password, checked by the database. The HTML isn't, so the password deliberately gates comments only, not viewing.

## 3. Repository layout

```
/
├─ README.md                  what this is and how it's used
├─ CLAUDE.md                  rules for agents creating prototypes (§8); must stay in the root
├─ index.html                 starts the viewer (the only viewer file outside /viewer)
├─ site.config.json           customer, defaultTheme, defaultVendor, comments (backend, project id,
│                             Supabase URL + publishable key); "template": true only in the template
├─ package.json               npm scripts only, no dependencies
├─ docs/
│  ├─ SPEC.md                 this file
│  ├─ background-ai-driven-html-prototyping.md   the discussion paper behind this project
│  └─ new-customer-site.md    how to make a customer site from the template (§7.3)
├─ prototypes/<slug>/
│  ├─ index.html              the prototype (self-contained apart from /vendor)
│  ├─ meta.json               metadata (§4.2)
│  └─ v<N>/index.html         optional frozen snapshots of earlier versions
├─ vendor/vaadin-<version>/   vaadin.js, aura.css (+ fonts/), lumo.css, base.css, build-info.json (§7)
├─ viewer/                    the viewer (plain HTML/CSS/ES modules, no dependencies, no build step)
│  ├─ comments/               comment panel, pins, anchors; backends/ = storage interface (§6)
│  └─ setup.js                the in-app setup guide (§6.6)
├─ scripts/
│  ├─ build-vendor.mjs        bundles components + themes from npm into vendor/vaadin-<version>/
│  ├─ build-manifest.mjs      creates and validates manifest.json from meta.json files + git history
│  ├─ serve.mjs               local server with the deployed layout (--pages mimics Pages caching)
│  ├─ init-site.mjs           turns a fresh copy of the template into one customer's site (§7.3)
│  ├─ check-viewer.cjs        Playwright check of the viewer, incl. switch timing (§7.1)
│  ├─ check-comments.cjs      Playwright check of comments (local backend + a mock Supabase)
│  └─ new-prototype.mjs       (M4, not built yet) creates a prototype folder from a starter
├─ supabase/schema.sql        comment tables, access rules (RLS) and functions
└─ .github/workflows/
   ├─ pages.yml               builds the manifest and deploys to GitHub Pages
   └─ setup-site.yml          "Set up site": runs init-site.mjs from the browser, then deploys
```

The deployed site layout: `/` = viewer, `/prototypes/...`, `/vendor/...`, `/manifest.json`. Everything is served from the same domain. The viewer relies on this (§5.3). All paths are relative, so the site also works under a project-pages subpath (`https://<org>.github.io/<repo>/`).

`manifest.json` is generated (in CI and locally before serving) and isn't committed. The root `index.html` only imports `viewer/main.js` and calls `startViewer(element, { manifestUrl })`; the viewer knows nothing else about the repository, which keeps it extractable (C9).

## 4. Prototypes

### 4.1 Prototype rules
- One folder per prototype under `prototypes/<slug>/`. The slug is kebab-case and never changes once published, because comments refer to it.
- `index.html` loads the components and theme only through relative paths to `/vendor/vaadin-<version>/`. No external network requests.
- Uses real Vaadin web components (`vaadin-*`) and one real Vaadin theme (Aura, Lumo or base styles), loaded from the vendor folder. No look-alikes. Use the site's `defaultTheme` unless told otherwise.
- **Variants** (design alternatives) live inside the prototype. The prototype reads `?variant=<id>` from its URL and lists its variants in `meta.json`. The viewer shows a variant switcher when there's more than one.
- Meaningful elements get stable `data-proto-id="<id>"` attributes (sections, forms, grids, key buttons, dialogs). Comment pins attach to these (§6.4).
- Light/dark is controlled from outside (§5.3). Prototypes must not hard-code a color scheme.

### 4.2 `meta.json`
```json
{
  "title": "Order list – bulk actions",
  "area": "Orders",
  "description": "Adds bulk status change to the order grid.",
  "created": "2026-11-26",
  "status": "draft | in-review | approved | archived",
  "vendor": "vaadin-25.x.y",
  "theme": "aura | lumo | base",
  "variants": [ { "id": "a", "label": "Toolbar actions" }, { "id": "b", "label": "Selection footer" } ],
  "snapshots": [ { "id": "v1", "label": "Review 2026-12-03" } ]
}
```

### 4.3 Versions
- The **current version** of a prototype is the SHA of the latest commit that touched its folder. `build-manifest.mjs` works it out from git history (the Actions checkout needs full history: `fetch-depth: 0`).
- GitHub Pages serves only the latest state. When a state needs to stay viewable (for example after a customer review), copy it into a `v<N>/` subfolder and list it in `snapshots`. The copy is one level deeper, so its vendor paths become `../../../vendor/...`; `build-manifest.mjs` checks that every listed snapshot exists. Snapshots are never edited afterwards. A snapshot keeps the variants it had, and the viewer passes `?variant=` to it the same way.

## 5. Viewer

### 5.1 Features (v1)
- **Prototype list**: a sidebar grouped by `area`, with search (title, area, description), a status badge, and a count of open comments. Archived prototypes are hidden by default (a deep link to an archived prototype still opens it and shows it in the list).
- **Stage**: the selected prototype is shown in an iframe.
- **Screen widths**: a compact dropdown in the header. The default is **Full** (the frame fills the stage). **Phone 390** and **Tablet 768** are offered in addition: the viewer is used on desktop, so wider sizes are checked by resizing the browser window. A custom width can still be dragged with handles on both edges of the frame (the frame stays centred); it then shows as a checked "Custom <n> px" entry. The button shows the current size. When a width doesn't fit the stage (e.g. a deep link with `w=1600`), the frame is scaled down to fit and the scale is shown; the prototype still sees the full width.
- **Theme**: a light/dark toggle.
- **Variant and snapshot switchers** (when `meta.json` lists them).
- **Open in new tab**, and **copy link**.
- **Comments** button in the header (with the open-thread count) that opens the comments panel; comment mode from the panel or the `C` key (§6). Hidden entirely when the site has no comments (`"backend": "none"`).
- **Setup guide** at `#/setup`: how to connect comment storage, inside the app (§6.6).
- **Deep links**: the URL hash holds all state, e.g. `#/p/<slug>?variant=b&snapshot=v1&w=390&theme=dark&thread=<id>`. Defaults are left out (first variant, current version, Full width, light). Opening that link restores the same view. Back/forward move between prototypes and variants; width and theme changes replace the history entry instead of adding one. Unknown parameters are kept as they are. Opening `/` without a hash shows the first non-archived prototype.
- Works on a laptop screen first. Viewing on a phone is a nice-to-have.

### 5.2 Data
The viewer loads `/manifest.json`, which `build-manifest.mjs` generates:
```json
{ "generated": "…", "customer": "…", "defaultTheme": "aura",
  "prototypes": [ { "slug": "…", "path": "prototypes/<slug>/", "version": "<sha>", "updated": "…", …meta } ] }
```
`build-manifest.mjs` also validates the prototypes: required `meta.json` fields, slug and id formats, that `index.html` loads the `vendor` and `theme` that `meta.json` names, no external `src`/`href`, and that listed snapshots exist. It warns about prototypes on a theme other than `defaultTheme` (C6b) and about unused vendor folders (§7.2). In CI it runs with `--strict`, which fails the deploy on errors. Locally, uncommitted changes to a prototype show its version as `<sha>+dirty`.

### 5.3 Same-origin control
The viewer and the prototypes are on the same domain, so the viewer can work directly inside the prototype's frame (`iframe.contentDocument`). There's no messaging protocol between them. This is how theme switching, comment-click capture and drawing pins work.
- Light/dark: the mapping lives in one small adapter (`viewer/theme-adapters.js`), selected by the prototype's `theme` in the manifest and applied to the frame's root element. The rest of the viewer stays theme-agnostic. In Vaadin 25 all three use the same mechanism, the CSS `color-scheme` property on `<html>`, because their colors are defined with `light-dark()`:
  - **Aura** and the **base styles**: `color-scheme` is their documented switch.
  - **Lumo**: `color-scheme` switches Lumo 25 completely (verified in the browser, including the registered `--vaadin-*` properties). Lumo's older switch, `theme="dark"` on `<html>`, is deliberately not used: its `[theme~='dark']` rule has higher specificity than a page's `html { --lumo-*: light-dark(…) }` and would override a customer's own dark colors. Vaadin's 25 docs describe it as kept for backwards compatibility.
  - The three stay separate adapter entries, so a theme or a later Vaadin version can change its mechanism without touching the rest of the viewer.
- The scheme is set as an inline style on the new document's root element as soon as that element exists, before first paint, and again on `DOMContentLoaded` and `load`, so switching prototypes in dark mode doesn't flash light. Toggling light/dark doesn't reload the prototype.
- Width: the iframe's own width. The prototype's media queries then behave as they would on a real screen.

## 6. Comments

Comments are optional. `site.config.json` → `comments` decides:
- `"backend": "none"`: no comment UI at all; the viewer is just a viewer.
- `"backend": "supabase"` with `project`, `supabase.url` and `supabase.publishableKey` set: shared comments for signed-in members.
- `"backend": "supabase"` not filled in yet (the template's default): the Comments panel says comments aren't set up and links to the setup guide (§6.6). It also offers **Try comments in this browser**: the same UI with a local backend that saves only in that browser, clearly labelled, for demos and testing.

### 6.1 User experience (Figma-like)
- Anyone with the site address can browse prototypes. To see or add comments, they **sign in once per browser** with the site's comment password and a display name (email optional). The name is shown with their comments; they can change it (for new comments) or sign out from the panel.
- Comment mode: a crosshair cursor and an outline of the element (with its `data-proto-id`) under the pointer. Clicking places a draft pin and opens a small composer next to it; the click never reaches the prototype. `Esc` cancels.
- Pins are numbered markers on top of the prototype, shown while the panel is open. Clicking one opens its thread (replies, edit/delete own comments, resolve, reopen). Resolved threads have no pin unless selected.
- The comments panel lists the threads for the current prototype: open first, resolved collapsed. Clicking a thread moves the view to its variant, snapshot, width and theme and highlights the pin; the thread id goes into the deep link (`thread=`).
- Each thread is badged **current**, **earlier version** (made on an older commit but its anchor still resolves) or **outdated** (its anchor no longer resolves). A thread whose element exists but isn't rendered right now (another tab, a closed dialog, another width) shows **not visible here**. Threads of another variant are listed with a chip and aren't pinned. Outdated threads appear only in the panel.

### 6.2 Access: comment password and membership
- One Supabase project (EU region) serves all customer sites. The viewer talks to it directly (plain `fetch`, no SDK) with the publishable key, which sits in `site.config.json` and is safe to make public. Access rules (row-level security, RLS) do all the protecting.
- Every visitor gets a Supabase **anonymous identity** (no account). On its own it can read and write nothing.
- Each customer is a `projects` row with its own **comment password**, stored only as a bcrypt hash. Signing in calls `join_project(slug, password, name, email)`, which checks the password in the database, rate-limits failures (5 per person and 50 per project in 15 minutes) and adds the visitor to `members` with their display name.
- Every access rule asks one question: is this user a current member of the thread's project? Customers never see each other's comments. Author names and emails are copied from the membership by the database; the browser can't set them.
- Changing a project's password (and bumping `password_version`) signs everyone out of that project.
- The password is typed, never put in a URL. Admins share it separately from the site link.
- Planned phase 2: **GitHub sign-in** as another way to become a member (Supabase's GitHub provider plus an allow-list of GitHub users per project). The membership model stays the same.

### 6.3 Data model (final version in `supabase/schema.sql`)
```
projects (id uuid pk, slug text unique, name text, password_hash text, password_version int, created_at)
members  (project_id fk, user_id uuid, display_name text, email text null, password_version int, joined_at; pk (project_id, user_id))
sign_in_attempts (project_id, user_id, succeeded, at)          -- for rate limiting
threads  (id uuid pk, project_id fk, prototype_slug text, variant text null, snapshot text null,
          version_sha text, anchor jsonb, viewport jsonb, theme text,
          status text check in ('open','resolved'), created_by uuid, created_at, resolved_at, resolved_by)
comments (id uuid pk, thread_id fk, author_id uuid, author_name text, author_email text null, body text, created_at, edited_at)
```
- `anchor`: `{ protoId | id | path, offset: {x, y}, fallback: {xPct, yPx}, label }` (§6.4)
- `viewport`: `{ width (null = Full), frameWidth, scrollY }`
- Functions: `join_project`, `my_membership`, `project_public` (name only), `set_my_name`, `leave_project`. Clients can't read `projects`, `members` or `sign_in_attempts` directly.
- Members can edit or delete their own comments (only `body` is writable). Any member can resolve or reopen a thread (only `status` is writable); `resolved_at`/`resolved_by` are set by the database.

### 6.4 Pin placement and re-finding
On click:
1. Take the actual clicked node from the event path (`composedPath()[0]`), so clicks inside shadow DOM count.
2. Walk up (crossing shadow roots via their host elements) to the nearest element with `data-proto-id`. If there isn't one, use the nearest element with a hand-written `id` (generated ids like `input-vaadin-text-field-12` are skipped). As a last resort, record a path of element indexes from the document that steps through shadow roots.
3. Store the click position as a fraction of that element's box (`offset`), plus a fallback position relative to the page and a short human-readable `label`.

When drawing: find the element again, then place the pin at `offset` inside its current box. Pins live in a layer in the viewer over the frame (not inside the prototype), mapped through the frame's scale. Redraw on scroll, resize, width change and DOM changes (throttled to one per frame). If the element can't be found, mark the thread **outdated**.

### 6.5 Feedback loop with Claude Code
A person reads the threads in the viewer and asks Claude Code for the changes, in their own words. After Claude revises a prototype, the threads are resolved in the viewer by a person, not by the agent. Agents don't read comments themselves, and there is no "copy as prompt": comments are rarely good instructions without someone's interpretation, and reading them would put the comment password into the agent's environment.

### 6.6 Setup guide (`#/setup`)
The viewer contains its own setup instructions, so a site admin needs nothing else:
1. Create the Supabase project (EU region, anonymous sign-ins on, run `supabase/schema.sql`, shown with a copy button).
2. Add the customer: generates a strong password and the SQL that stores only its bcrypt hash, plus the SQL to change it.
3. Connect the site: the `site.config.json` snippet, and a **connection check** against the values typed on the page (reachability, schema, project id, password, read access), before anything is committed.
4. Sharing, turning comments off, using another database, troubleshooting.

**Other databases:** the viewer reaches comment storage only through the interface in `viewer/comments/backends/index.js` (connect, sign in/out, rename, list threads, open counts, create thread, add/edit/delete comment, set status). Supabase and the local (this-browser) backend are the two implementations; another database is one more file plus `"backend": "<name>"`.

## 7. Build and deploy
- `.github/workflows/pages.yml`: on push to `main`, check out with full history, run `build-manifest.mjs`, upload the site, and deploy with `actions/deploy-pages`. The site includes `supabase/schema.sql`, so the setup guide can show it.
- `vendor/` is committed. `build-vendor.mjs` runs only when someone deliberately upgrades the Vaadin version (Vaadin web component packages from npm, bundled with esbuild into one ES module, plus a separate CSS file per theme: Aura, Lumo and the base styles). A new version goes into a new `vendor/vaadin-<version>/` folder and existing ones aren't touched (`--force` is needed to rebuild one; the build is reproducible).
- What goes into a vendor folder (first version: **25.3.7**):
  - `vaadin.js`: every free (Apache-2.0) component package that `@vaadin/vaadin-core` depends on, plus Lumo's `lumo:` iconset. `@vaadin/vaadin-core` itself isn't used, because it also pulls in `@vaadin/router` and the usage statistics.
  - `aura.css` from `@vaadin/aura` (with `fonts/InstrumentSans.woff2` as a separate file), `lumo.css` from `@vaadin/vaadin-lumo-styles`, and the optional `lumo-utility.css`.
  - `base.css`: there is no package or stylesheet for the base styles; since Vaadin 25 they are built into each component. `base.css` only gives the page a font and the base background/text colors (otherwise the page is serif and stays white in dark mode).
  - `build-info.json` (versions, packages, sizes) and the licence texts.
- `@vaadin/vaadin-usage-statistics` (imported by `@vaadin/component-base`) is replaced with a no-op at bundle time: on localhost it would POST to tools.vaadin.com, and prototypes make no external requests (§4.1). The build fails if any output references an external URL.
- No build step for prototypes and no AI in CI.

### 7.1 Performance
- **Why bundle instead of a CDN:** a CDN like esm.sh serves many small modules that the browser finds one import at a time. One bundled ES module plus one CSS file on the same domain means fewer requests and no extra connection setup. Browsers keep a separate cache per website, so a public CDN gives no shared-cache advantage.
- **One shared bundle per version**, not one per prototype, so it's downloaded once and reused by every prototype on that version.
- **Size budget:** `build-vendor.mjs` prints the minified and gzipped size of each output file. Leave out heavy optional packages (e.g. charts, the rich text editor) unless a prototype needs them. If needed, they go in a separate optional bundle loaded only by those prototypes.
- **Caching:** GitHub Pages can't set custom cache headers (files are cached for about 10 minutes, then the browser checks whether they changed). Version folders never change, so those checks are cheap "not modified" answers.
- **Switching prototypes** reloads the iframe, and the browser runs the cached bundle again. Target: switching between two prototypes on the same vendor version feels quick (under ~500 ms until the page is usable on a typical laptop, measured in M2).
- **"Usable"** means: the frame's `load` event has fired, every custom element the page uses is defined (internal helper elements inside a component, such as `vaadin-grid-cell-content`, are ignored), fonts are loaded, and two frames have been painted. The viewer measures it from the click and exposes it as `window.__protoViewer.lastReadyMs`; `scripts/check-viewer.cjs` measures with Pages-like caching (`serve.mjs --pages`).
- **Measured** (Chromium in a cloud container, warm cache, 20 switches each): median 330–375 ms, p95 under 480 ms; with the CPU throttled 4×, about 1.4–1.8 s. Network time is near zero when cached; about 170 ms goes to running `vaadin.js` (1225 KB minified / 310 KB gzipped), the rest to the prototype's own rendering.
- **If switching gets too slow**, the next lever is the bundle's run time, not the network: split `vaadin.js` per component (still one vendor folder per version, still same-origin) so a prototype runs only what it imports.

### 7.2 Vendor version policy
- Add a new `vendor/vaadin-<version>/` only when it's needed (a release with relevant changes), not for every Vaadin release.
- When a prototype that's still being worked on is edited, move it to the newest vendored version.
- Only archived prototypes stay on old versions. Aim for two or three versions in use at any time.
- Remove a vendor folder once no prototype or snapshot uses it. `build-manifest.mjs` warns about unused vendor folders.
- Different versions never load into the same document, because each prototype runs in its own iframe. This is why the viewer must always keep prototypes in an iframe.

### 7.3 New customer sites (template)
About 10 minutes per customer, all in the browser; the steps are in [new-customer-site.md](new-customer-site.md). The design:
- **Use this template**, turn on Pages, then run the **Set up site** action (`setup-site.yml`) with the customer name, theme and comments on/off. It runs `scripts/init-site.mjs` (removes the example prototypes, writes `site.config.json` and a customer README), commits, and dispatches `pages.yml` itself, because a push made with the workflow token doesn't trigger other workflows.
- It runs once (`"template": true` in `site.config.json` marks a site that isn't set up yet) and never in the template repository (`github.event.repository.is_template`).
- The shared Supabase URL and publishable key are set once in the template, so a new site only needs a project id and a comment password (`#/setup`, step 2).
- The Playwright checks use the example prototypes, so they run in the template repository, where the viewer is developed; in a customer site they exit with a note.

## 8. Agent instructions (`CLAUDE.md` in each customer repo)
It must tell the agent to:
- Create new prototypes with `scripts/new-prototype.mjs` (or follow the same layout), fill in `meta.json`, and never rename a slug.
- Read the background paper for context on what the prototypes are for.
- Use only `vendor/` components and themes, real Vaadin components, and no CDNs.
- Use the same theme as the existing prototypes (`defaultTheme` in `site.config.json`) unless the user asks for another.
- Add `data-proto-id` to meaningful elements and keep existing ids stable when editing, so pins keep their place.
- Put design alternatives in variants, not in new prototypes.
- Not edit other prototypes unless asked.
- Check the work: serve the repo locally, open the prototype through the viewer with Playwright at Phone width and on desktop (Full), in light and dark, and look at the screenshots.
- Work on feedback as a person describes it; don't read or resolve comments yourself (§6.5).
- Follow the customer design system in `design-system/` (added per customer later; out of scope for v1).

A theme-agnostic Vaadin prototyping skill, `vaadin-html-prototype` (Aura, Lumo or the base styles), is available in the Claude workspace and is the intended source of component-usage guidance. `CLAUDE.md` points agents to its references for components and tokens, but not to its build script or its self-contained output: in this repo, pages load from `vendor/`. Keep `CLAUDE.md` limited to the repo conventions above, and don't copy theme-specific guidance from the older Aura-only skill.

## 9. Out of scope for v1
Email/Slack notifications, @mentions, real-time live updates, private hosting, extracting the shared viewer package (phase 2), customer design-system content, Flow code generation.

## 10. Milestones
| | Milestone | Done when | Status |
|---|---|---|---|
| M1 | **Skeleton**: repo layout, `build-vendor.mjs` (pinned Vaadin, Aura/Lumo/base), example prototypes, `build-manifest.mjs`, Pages workflow | an example prototype is visible on GitHub Pages with no external requests; the vendor build reports minified and gzipped sizes | Built; first Pages deployment pending |
| M2 | **Viewer**: everything in §5 | switching between ≥3 prototypes, widths, themes and variants; a copied deep link restores the view; switch time meets §7.1 | Done (`check-viewer.cjs`, 41 checks) |
| M3 | **Comments**: schema, anonymous identities, comment password + membership, pins, threads, resolve, panel, version badges, setup guide, works without comments | two signed-in browsers see each other's comments after a refresh; a browser that hasn't signed in can't read them; pins stay on their element across widths | Built (`check-comments.cjs`, 51 checks against a mock; schema tested on Postgres); real Supabase pending |
| M4 | **Agent loop**: `CLAUDE.md`, `new-prototype.mjs` | a Claude Code session can create a prototype, and revise it from feedback a person passes on, using only the repo instructions | `CLAUDE.md` done; `new-prototype.mjs` open |
| M5 | **Template**: `new-customer-site.md`, `init-site.mjs`, Set up site action, empty-site state | a new customer site runs in under 15 minutes | Built; first real customer site pending |

## 11. Open questions
1. Is it acceptable that prototype HTML is publicly reachable by URL on GitHub Pages?
2. Who owns the Supabase account and project (Vaadin org account, EU region)?
3. Comment retention: keep threads forever, or purge them for archived prototypes?
4. **Open in new tab** opens the prototype's own URL, which can't carry the light/dark choice, because prototypes don't read a theme from their URL (§4.1). Accept that, or let prototypes honour `?theme=dark` (a few lines of shared script in the vendor folder)?
5. GitHub sign-in (phase 2): an allow-list of GitHub users per project, managed where (SQL, or a small admin page)?
