# vaadin-prototypr

A per-customer site for HTML prototypes of Vaadin UIs: real Vaadin 25 web
components and a real Vaadin theme (Aura, Lumo or base styles), browsed in one
viewer on GitHub Pages. See [SPEC.md](SPEC.md) for the specification and
[CLAUDE.md](CLAUDE.md) for how prototypes are made.

## Run locally

Needs Node 20+. No `npm install`: there are no dependencies.

```bash
npm run serve
```

Then open http://localhost:8080/. (`npm run serve` builds `manifest.json` and
starts `scripts/serve.mjs`.)

## Scripts

| Script | What it does |
|---|---|
| `scripts/build-manifest.mjs` | Builds `manifest.json` from `prototypes/*/meta.json` and git history; validates meta and vendor references (`--strict` fails on errors, used in CI). |
| `scripts/serve.mjs [port] [--pages]` | Static server with the same layout as GitHub Pages. `--pages` mimics Pages caching. |
| `scripts/build-vendor.mjs [version]` | Bundles a Vaadin version from npm into `vendor/vaadin-<version>/` and prints file sizes. Run only when deliberately adding a version. |
| `scripts/check-viewer.cjs` | Playwright end-to-end check of the viewer, including prototype-switch timing. |

## Deploy

`.github/workflows/pages.yml` deploys `main` to GitHub Pages. In the repository
settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.
