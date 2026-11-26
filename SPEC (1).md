# Vaadin Prototype Viewer – Specification (v1)

Status: draft for phase 1 (internal use, shared with customers by link)
Owner: Juuso Kantonen, Vaadin

## 1. Purpose

A per-customer website that collects every HTML prototype made for that customer, lets anyone with the link browse them in one viewer, and lets them leave Figma-style pinned comments on top of the designs.

Prototypes are AI-built HTML stand-ins for Vaadin Flow UIs. They use the real Vaadin web components and a real Vaadin theme (Aura, Lumo or the base styles), and they get translated into Vaadin Flow (Java) code later. Flow components are Java wrappers around the same web components, so the handoff is mostly a direct mapping.

**Background:** read `docs/background-ai-driven-html-prototyping.md` first. It's the discussion paper this project comes from: why customers want AI-built prototypes, the role of customer design systems, and the prototyping setups tried so far. This project is the evolution of its **Setup A** (boilerplate repository), adding the sharing, comments and long-lived viewer that Setup A lacked. Where the paper and this spec differ, this spec decides.

How this spec reads two of the paper's principles:
- *Prototypes are throwaway:* each prototype still answers one focused design question. Once it has served its purpose it's **archived** (status `archived`), not deleted, so the site keeps a record.
- *Versioning and branching:* "branching" means trying another design direction. Here that's done with **variants** inside a prototype, not Git branches (C4).

## 2. Constraints and decisions

| # | Decision |
|---|----------|
| C1 | **No Anthropic API usage.** Prototypes are created with Claude Code on the web (or locally) on a Claude subscription. Nothing in this project calls an LLM API, including the CI. |
| C2 | **Hosting is GitHub Pages**, deployed by GitHub Actions from `main`. |
| C3 | **One repository per customer.** It's created from this repository, which is a GitHub template repository. |
| C4 | **No branch-based workflow.** All prototypes live on `main`. Design alternatives live *inside* a prototype (variants). Branches made by Claude Code sessions are just a way to get work merged. |
| C5 | **Prototypes are long-lived.** The site grows over months. Earlier prototypes stay available, and prototypes can come from unrelated parts of the application. |
| C6 | **Same tech stack, pinned.** All prototypes use Vaadin web components and a Vaadin theme, served from the repo (no CDN at runtime). Each prototype records which vendored version it uses, so later upgrades don't break older prototypes. |
| C6b | **Theme-agnostic, one theme per site by convention.** The tooling supports Aura, Lumo and the base styles. A customer site normally uses one theme throughout (`site.config.json` → `defaultTheme`), and new prototypes use the same theme as earlier ones. Mixing themes between prototypes is technically possible but not expected. The viewer doesn't care which theme a prototype uses. |
| C7 | **Comments are a must-have.** Anyone with the link can comment without a GitHub account. Comments are stored outside GitHub (Supabase). |
| C8 | **No Claude artifacts.** Prototypes aren't hosted or viewed through claude.ai. |
| C9 | **Viewer code is kept separate** (`/viewer`), so it can later move into a shared package that all customer repos use (phase 2). |

Known consequence: the prototype pages on GitHub Pages are public to anyone who has the URL (unless the org has GitHub Enterprise Cloud with private Pages). Comments are protected by a share token. The HTML isn't.

## 3. Repository layout

```
/
├─ SPEC.md                    this file
├─ CLAUDE.md                  rules for agents creating prototypes (see §8)
├─ docs/
│  └─ background-ai-driven-html-prototyping.md   context: the discussion paper behind this project
├─ site.config.json           customer name, Supabase URL + publishable key, default vendor version, defaultTheme
├─ prototypes/
│  └─ <slug>/
│     ├─ index.html           the prototype (self-contained apart from /vendor)
│     ├─ meta.json            metadata (see §4.2)
│     └─ v<N>/index.html      optional frozen snapshots of earlier versions
├─ vendor/
│  └─ vaadin-<version>/       bundled Vaadin web components + theme CSS for aura, lumo and base (committed)
├─ viewer/                    the viewer app (static HTML/JS/CSS, no framework needed)
├─ scripts/
│  ├─ build-vendor.mjs        bundles components + theme from npm into /vendor/vaadin-<version>/
│  ├─ build-manifest.mjs      creates manifest.json from prototypes/*/meta.json + git history
│  ├─ new-prototype.mjs       creates a new prototype folder from a starter file
│  └─ fetch-comments.mjs      prints open comments for a prototype as markdown (for agents)
├─ supabase/
│  └─ schema.sql              tables, access rules (RLS) and functions for comments
└─ .github/workflows/pages.yml  builds the manifest and deploys to GitHub Pages
```

The deployed site layout: `/` = viewer, `/prototypes/...`, `/vendor/...`, `/manifest.json`. Everything is served from the same domain. The viewer relies on this (§5.3).

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
- GitHub Pages serves only the latest state. When a state needs to stay viewable (for example after a customer review), copy it into a `v<N>/` subfolder and list it in `snapshots`.

## 5. Viewer

### 5.1 Features (v1)
- **Prototype list**: a sidebar grouped by `area`, with search (title, area, description), a status badge, and a count of open comments. Archived prototypes are hidden by default.
- **Stage**: the selected prototype is shown in an iframe.
- **Screen widths**: presets for Phone 390, Tablet 768, Laptop 1280, Desktop 1440 and Full. A custom width can be dragged. The current width is shown.
- **Theme**: a light/dark toggle.
- **Variant and snapshot switchers** (when `meta.json` lists them).
- **Open in new tab**, and **copy link**.
- **Comment mode** toggle, plus a comments panel (§6).
- **Deep links**: the URL hash holds all state, e.g. `#/p/<slug>?variant=b&w=390&theme=dark&thread=<id>`. Opening that link restores the same view.
- Works on a laptop screen first. Viewing on a phone is a nice-to-have.

### 5.2 Data
The viewer loads `/manifest.json`, which `build-manifest.mjs` generates:
```json
{ "generated": "…", "customer": "…",
  "prototypes": [ { "slug": "…", "path": "prototypes/<slug>/", "version": "<sha>", "updated": "…", …meta } ] }
```

### 5.3 Same-origin control
The viewer and the prototypes are on the same domain, so the viewer can work directly inside the prototype's frame (`iframe.contentDocument`). There's no messaging protocol between them. This is how theme switching, comment-click capture and drawing pins work.
- Light/dark: each theme has its own documented mechanism (check them for Vaadin 25; e.g. Lumo uses a `theme="dark"` attribute on the root element, and Aura and the base styles may rely on `color-scheme`). Put the mapping in one small adapter, selected by the prototype's `theme` in the manifest, and apply it to the frame's root element. The rest of the viewer stays theme-agnostic.
- Width: the iframe's own width. The prototype's media queries then behave as they would on a real screen.

## 6. Comments

### 6.1 User experience (Figma-like)
- Anyone with the customer link can view and comment.
- The first time they comment, they're asked for a display name (an email is optional). It's remembered in the browser.
- Comment mode: a crosshair cursor. Clicking anywhere in the prototype places a pin and opens a new comment thread.
- Pins are numbered markers on top of the prototype. Clicking one opens its thread (replies, resolve, reopen).
- The comments panel lists the threads for the current prototype: open first, resolved collapsed. Clicking a thread moves the view to its variant, width and theme and highlights the pin.
- Each thread is badged **current**, **earlier version** (made on an older commit but its anchor still resolves) or **outdated** (its anchor no longer resolves). Outdated threads appear only in the panel and aren't drawn as pins.
- **Copy as prompt**: copies all open threads of the current prototype as markdown, ready to paste into Claude Code. Each entry has the element, the comment text, the variant/width/theme, and the author.

### 6.2 Backend: Supabase
- One Supabase project (EU region) serves all customer sites. The viewer talks to it directly with the publishable (anon) key, which sits in `site.config.json` and is safe to make public. Access rules (row-level security, RLS) do all the protecting.
- Supabase **anonymous sign-in** gives each commenter an identity without an account. The display name is stored with each comment.
- **Keeping customers apart:** each customer is a `project` row with a secret **share token**. The token is never committed. It travels in the link fragment (`#t=<token>`) and is kept in browser storage after the first visit. The viewer sends it on every request as a custom header (`x-share-token`). The access rules allow reading and writing only for rows whose project matches that token (store the token hashed and compare with `request.headers`). If there's no valid token, the viewer works read-only and shows no comments.

### 6.3 Data model (sketch, final version in `supabase/schema.sql`)
```
projects (id uuid pk, slug text unique, name text, share_token_hash text, created_at)
threads  (id uuid pk, project_id fk, prototype_slug text, variant text null, snapshot text null,
          version_sha text, anchor jsonb, viewport jsonb, theme text,
          status text check in ('open','resolved'), created_by uuid, created_at, resolved_at, resolved_by)
comments (id uuid pk, thread_id fk, author_id uuid, author_name text, body text, created_at, edited_at)
```
- `anchor`: `{ protoId, path, offset: {x, y}, fallback: {xPct, yPx} }` (§6.4)
- `viewport`: `{ width, scrollY }`
- Authors can edit or delete their own comments. Anyone with the token can resolve or reopen a thread.

### 6.4 Pin placement and re-finding
On click:
1. Take the actual clicked node from the event path (`composedPath()[0]`), so clicks inside shadow DOM count.
2. Walk up (crossing shadow roots via their host elements) to the nearest element with `data-proto-id`. If there isn't one, use the nearest element with an `id`. As a last resort, record a CSS path from the top of the document that steps through shadow roots.
3. Store the click position as a fraction of that element's box (`offset`), plus a fallback position relative to the page.

When drawing: find the element again, then place the pin at `offset` inside its current box. Redraw on scroll, resize, width change and DOM changes (throttled). If the element can't be found, mark the thread **outdated**.

### 6.5 Feedback loop with Claude Code
`scripts/fetch-comments.mjs <slug>` prints the open threads as markdown, in the same format as "Copy as prompt". It reads the Supabase URL from `site.config.json` and the share token from an environment variable. Claude Code on the web sessions must add the Supabase domain to the environment's allowed network domains. After Claude revises a prototype, the threads are resolved in the viewer by a person, not by the agent.

## 7. Build and deploy
- `.github/workflows/pages.yml`: on push to `main`, check out with full history, run `build-manifest.mjs`, upload the site, and deploy with `actions/deploy-pages`.
- `vendor/` is committed. `build-vendor.mjs` runs only when someone deliberately upgrades the Vaadin version (Vaadin web component packages from npm, bundled with esbuild into one ES module, plus a separate CSS file per theme: Aura, Lumo and the base styles). A new version goes into a new `vendor/vaadin-<version>/` folder and existing ones aren't touched.
- No build step for prototypes and no AI in CI.

### 7.1 Performance
- **Why bundle instead of a CDN:** a CDN like esm.sh serves many small modules that the browser finds one import at a time. One bundled ES module plus one CSS file on the same domain means fewer requests and no extra connection setup. Browsers keep a separate cache per website, so a public CDN gives no shared-cache advantage.
- **One shared bundle per version**, not one per prototype, so it's downloaded once and reused by every prototype on that version.
- **Size budget:** `build-vendor.mjs` prints the minified and gzipped size of each output file. Leave out heavy optional packages (e.g. charts, the rich text editor) unless a prototype needs them. If needed, they go in a separate optional bundle loaded only by those prototypes.
- **Caching:** GitHub Pages can't set custom cache headers (files are cached for about 10 minutes, then the browser checks whether they changed). Version folders never change, so those checks are cheap "not modified" answers.
- **Switching prototypes** reloads the iframe, and the browser runs the cached bundle again. Target: switching between two prototypes on the same vendor version feels quick (under ~500 ms until the page is usable on a typical laptop, measured in M2).

### 7.2 Vendor version policy
- Add a new `vendor/vaadin-<version>/` only when it's needed (a release with relevant changes), not for every Vaadin release.
- When a prototype that's still being worked on is edited, move it to the newest vendored version.
- Only archived prototypes stay on old versions. Aim for two or three versions in use at any time.
- Remove a vendor folder once no prototype or snapshot uses it. `build-manifest.mjs` warns about unused vendor folders.
- Different versions never load into the same document, because each prototype runs in its own iframe. This is why the viewer must always keep prototypes in an iframe.

## 8. Agent instructions (`CLAUDE.md` in each customer repo)
It must tell the agent to:
- Create new prototypes with `scripts/new-prototype.mjs` (or follow the same layout), fill in `meta.json`, and never rename a slug.
- Read `docs/background-ai-driven-html-prototyping.md` for context on what the prototypes are for.
- Use only `vendor/` components and themes, real Vaadin components, and no CDNs.
- Use the same theme as the existing prototypes (`defaultTheme` in `site.config.json`) unless the user asks for another.
- Add `data-proto-id` to meaningful elements and keep existing ids stable when editing, so pins keep their place.
- Put design alternatives in variants, not in new prototypes.
- Not edit other prototypes unless asked.
- Check the work: serve the repo locally, open the prototype with Playwright at Phone and Desktop widths in light and dark, and look at the screenshots.
- Use `scripts/fetch-comments.mjs` when asked to work on feedback.
- Follow the customer design system in `design-system/` (added per customer later; out of scope for v1).

A theme-agnostic Vaadin prototyping skill (one that works with Aura, Lumo or the base styles) is being developed separately. It's meant to work alongside this repo and is the intended source of component-usage guidance. Until it's available, keep `CLAUDE.md` limited to the repo conventions above, and don't copy theme-specific guidance from the older Aura-only skill.

## 9. Out of scope for v1
Email/Slack notifications, @mentions, real-time live updates, private hosting, extracting the shared viewer package (phase 2), customer design-system content, Flow code generation.

## 10. Milestones
- **M1 – Skeleton.** Repo layout, `build-vendor.mjs` with a pinned Vaadin version and all three themes (Aura, Lumo, base), one example prototype with two variants, `build-manifest.mjs`, Pages workflow. *Done when:* the example prototype is visible on GitHub Pages with no external requests, and the vendor build reports its minified and gzipped bundle sizes.
- **M2 – Viewer.** Everything in §5. *Done when:* you can switch between ≥3 prototypes, widths, themes and variants, and a copied deep link restores the exact view. Switching between prototypes on the same vendor version meets the target in §7.1 (measured with Playwright and reported).
- **M3 – Comments.** `schema.sql`, anonymous sign-in, share token, pins, threads, resolve, panel, version badges. *Done when:* two browsers with the same link see each other's comments after a refresh, a link without the token can't read them, and pins stay on their element across width changes.
- **M4 – Agent loop.** `CLAUDE.md`, `new-prototype.mjs`, `fetch-comments.mjs`, "Copy as prompt". *Done when:* a Claude Code session can create a prototype and act on its comments using only the repo instructions.
- **M5 – Template.** README for creating a customer repo from the template (Pages setup, Supabase project row + token, config). *Done when:* a new customer site is running in under 15 minutes.

## 11. Open questions
1. Is it acceptable that prototype HTML is publicly reachable by URL on GitHub Pages?
2. Which exact Vaadin 25 version to pin first, and the npm package names for the Aura, Lumo and base-style CSS.
3. Who owns the Supabase account and project (Vaadin org account, EU region)?
4. Comment retention: keep threads forever, or purge them for archived prototypes?
