# vaadin-prototypr

One website per customer that collects all their Vaadin HTML prototypes in one viewer.

## How it's used

1. **Create the customer's repo** from this template and set the customer name and theme in `site.config.json`.
2. **Enable GitHub Pages:** Settings → Pages → Source: **GitHub Actions**.
3. **Make prototypes with Claude Code.** Ask for a prototype ("an order list with bulk actions, two variants"). The agent follows `CLAUDE.md`: it creates `prototypes/<slug>/` and checks the result in the viewer.
4. **Merge to `main`.** The site deploys automatically.
5. **Share the link.** Customers browse the prototypes and switch widths, light/dark and variants. **Copy link** shares the exact view.

Try it locally (Node 20+, nothing to install):

```bash
npm run serve
```

Then open http://localhost:8080/. The details are in [SPEC.md](SPEC.md).
