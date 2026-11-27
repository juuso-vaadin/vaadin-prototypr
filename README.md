# vaadin-prototypr

The template for per-customer prototype sites: Vaadin HTML prototypes, built with
Claude Code from the real Vaadin web components and theme, browsed in one viewer on
GitHub Pages, with optional password-protected comments.

## How it's used

1. **Create a customer site** from this template: about 10 minutes, all in the browser.
   Follow [docs/new-customer-site.md](docs/new-customer-site.md) (Use this template →
   turn on Pages → run the **Set up site** action → comment password).
2. **Make prototypes with Claude Code** in the customer's repository. Describe the
   screen ("an order list with bulk actions, two variants"). The agent follows
   [CLAUDE.md](CLAUDE.md), creates `prototypes/<slug>/` and checks the result in the viewer.
3. **Merge to `main`.** The site deploys automatically.
4. **Share the link** with the customer. They switch widths, light/dark and variants,
   and **Copy link** shares the exact view.
5. **Comments (optional).** People sign in with the site's comment password and their
   name, then pin comments on prototypes. Setup is explained inside the site at
   `#/setup`.

This repository's own site shows three example prototypes. A customer site starts empty.

Try it locally (Node 20+, nothing to install):

```bash
npm run serve
```

Then open http://localhost:8080/. The specification is [docs/SPEC.md](docs/SPEC.md).
