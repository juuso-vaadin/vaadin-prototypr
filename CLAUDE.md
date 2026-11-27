# CLAUDE.md – rules for agents working in this repository

This repository is a **prototype site for one customer**: HTML prototypes of
Vaadin Flow UIs, built from the real Vaadin web components and a real Vaadin
theme, browsed in a viewer on GitHub Pages. `SPEC.md` is the specification.
Read `docs/background-ai-driven-html-prototyping.md` once for context: what the
prototypes are for, and why they must stay close to what Vaadin Flow renders.

Prototypes are later translated into Vaadin Flow (Java). Every building block
you use should have a direct Flow equivalent.

## Layout

```
site.config.json          customer name, defaultTheme, defaultVendor
prototypes/<slug>/        one folder per prototype
  index.html              the prototype
  meta.json               its metadata
  v<N>/index.html         optional frozen snapshots of earlier versions
vendor/vaadin-<version>/  bundled Vaadin components + theme CSS (never edit)
viewer/                   the viewer app (don't edit when working on prototypes)
scripts/                  build-manifest, serve, build-vendor, check-viewer, check-comments
supabase/schema.sql       comment storage: tables, access rules, functions
```

## Creating a prototype

1. Pick a slug: kebab-case, describes the design question, e.g.
   `order-list-bulk-actions`. **A slug never changes once it's on `main`**:
   links (and, later, comments) refer to it.
2. Create `prototypes/<slug>/index.html` and `prototypes/<slug>/meta.json`.
   (`scripts/new-prototype.mjs` will do this in a later milestone; until then,
   copy the skeleton below.)
3. Use the theme and vendor version from `site.config.json` (`defaultTheme`,
   `defaultVendor`) unless the user asks for another. Keep to one theme per
   site: new prototypes use the same theme as existing ones.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Short title</title>
  <!-- theme: aura.css | lumo.css | base.css, from the same vendor folder -->
  <link rel="stylesheet" href="../../vendor/vaadin-25.3.7/aura.css" />
  <script type="module" src="../../vendor/vaadin-25.3.7/vaadin.js"></script>
  <style>
    html, body { margin: 0; }
    /* page CSS: read theme tokens, no literal colors */
  </style>
</head>
<body>
  <!-- Vaadin components, data-proto-id on meaningful elements -->
  <script type="module">
    const variant = new URLSearchParams(location.search).get('variant') ?? 'a';
    // sample data and behaviour
  </script>
</body>
</html>
```

`meta.json`:

```json
{
  "title": "Order list – bulk actions",
  "area": "Orders",
  "description": "One or two sentences: the design question this prototype answers.",
  "created": "2026-11-26",
  "status": "draft",
  "vendor": "vaadin-25.3.7",
  "theme": "aura",
  "variants": [ { "id": "a", "label": "Toolbar actions" }, { "id": "b", "label": "Selection footer" } ],
  "snapshots": []
}
```

- `status`: `draft` → `in-review` → `approved`; `archived` when it has served
  its purpose (archive, don't delete).
- `area` groups prototypes in the viewer. Reuse an existing area name when one fits.
- `variants`: leave empty (`[]`) for a single design. Ids are short and lowercase.
- `vendor` and `theme` must match what `index.html` loads; `build-manifest.mjs`
  checks this.

## Rules

- **Vendor only.** Load components and theme only through the relative paths to
  `vendor/vaadin-<version>/`. No CDNs, no external fonts, images or scripts:
  a prototype makes no network requests outside this site. Write sample data
  into the page.
- **Real Vaadin components.** Use `vaadin-*` elements, not look-alikes. No raw
  `<button>`, `<input>`, `<select>`, `<dialog>` where a Vaadin component exists.
  Plain `<div>`/`<section>` with flex/grid is fine for page structure.
  Commercial components (Charts, Grid Pro, Crud, Rich Text Editor, Board,
  Dashboard, Map) are not in the bundle; ask before planning on one.
- **Theme variants, tokens.** Use the `theme` attribute for component variants
  (`theme="primary"`). In page CSS, read the theme's tokens (`--aura-*` /
  `--vaadin-*` for Aura, `--lumo-*` / `--vaadin-*` for Lumo, `--vaadin-*` for
  base styles), not hex colors or pixel spacing.
- **Light/dark is controlled from outside.** The viewer sets it. Never hard-code
  `color-scheme` or `theme="dark"` on `<html>`, and never use colors that only
  work in one scheme. If you customise theme colors, give both schemes, e.g.
  `light-dark(...)` or the theme's `-light`/`-dark` property pairs.
- **`data-proto-id` on meaningful elements**: sections, forms, grids, key
  buttons, dialogs, cards. Ids are kebab-case and unique within the page. When
  editing, **keep existing ids stable** (feedback pins will attach to them).
- **Variants, not new prototypes, for design alternatives.** The page reads
  `?variant=<id>` and renders that variant; list the variants in `meta.json`.
  Keep content and data identical across variants so they compare fairly.
- **Snapshots** keep a reviewed state viewable: copy `index.html` to
  `v<N>/index.html` (fix the vendor path to `../../../vendor/...`) and add
  `{ "id": "v<N>", "label": "Review <date>" }` to `snapshots`. Never change a
  snapshot afterwards.
- **Stay in your prototype.** Don't edit other prototypes, the viewer,
  `vendor/` or `scripts/` unless the user asks.
- **Vendor versions.** When you edit a prototype that's still being worked on,
  move it to the newest vendor folder (update both `index.html` and `meta.json`).
  Archived prototypes stay where they are. Adding a new vendor version is a
  deliberate decision for a human (`node scripts/build-vendor.mjs <version>`).

## Component and theme guidance

- If the `vaadin-html-prototype` skill is available, use its references
  (components, web-component usage, and the Aura / Lumo / base theme guides) for
  how to use components and tokens. Don't use its build script or its
  self-contained output: in this repo, pages load from `vendor/` instead.
- If the Vaadin MCP server is available, use it (`get_component_web_component_api`,
  `search_vaadin_docs`, `vaadin_version: "25.3"`) instead of guessing attributes,
  events or variants.
- Simple values are attributes (`label="Name" required`); arrays, objects and
  renderers are JS properties (`grid.items = [...]`). Write page JS in
  `<script type="module">`, which runs after the components are defined.
- Customer design system: follow `design-system/` if it exists (added per
  customer later).

## Checking your work

Always look at what you built before saying it's done:

```bash
node scripts/build-manifest.mjs     # validates meta.json + vendor references; fix every error
node scripts/serve.mjs 8080         # serves the site like GitHub Pages
```

Then use Playwright (preinstalled in Claude Code cloud sessions) to open the
prototype **through the viewer** at Phone width and on desktop (Full, in a
browser window about 1440 × 900), in light and dark, take screenshots and look
at them:

```
http://localhost:8080/#/p/<slug>?w=390
http://localhost:8080/#/p/<slug>?theme=dark
http://localhost:8080/#/p/<slug>?variant=b&w=390&theme=dark
```

Wait until the prototype is ready (`window.__protoViewer.readyCount` increases)
before taking the screenshot. Also check the page has no console errors and no
requests to other hosts. Click through the main path (buttons open their dialog,
selections update the UI).

If you changed the viewer, run `node scripts/check-viewer.cjs` and
`node scripts/check-comments.cjs` (all checks must pass). If you changed
`supabase/schema.sql`, keep it re-runnable and test it against Postgres.

## Comments and feedback

- Comments are optional per site (`site.config.json` → `comments`; `"backend": "none"`
  turns them off). Setup is explained inside the viewer at `#/setup`.
- Feedback reaches you through a person: work from what the user tells you. Don't
  read, answer or resolve comments yourself, and never put the comment password in
  the repository.
- Pins attach to `data-proto-id`s, which is why existing ids must stay stable.

## Viewer code (for viewer work only)

`viewer/` is plain HTML, CSS and ES modules with no dependencies and no build
step, kept separate so it can become a shared package. Theme-specific behaviour
lives only in `viewer/theme-adapters.js`; nothing else in the viewer may depend
on which theme a prototype uses. Prototypes always run in an iframe. Comment
storage is reached only through `viewer/comments/backends/` (one file per backend).
