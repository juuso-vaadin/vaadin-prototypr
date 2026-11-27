#!/usr/bin/env node
/**
 * init-site.mjs: turns a fresh copy of the template into one customer's site (M5).
 * Run once, right after creating the repository from the template. The "Set up site"
 * GitHub Action runs it for you; see docs/new-customer-site.md.
 *
 *   node scripts/init-site.mjs --customer "ACME Corp" [--theme aura|lumo|base]
 *        [--project acme-corp] [--no-comments] [--keep-examples] [--site-url URL] [--force]
 *
 *   --customer       customer name shown in the viewer (required)
 *   --theme          default Vaadin theme for this site's prototypes (default: aura)
 *   --project        comment project id in the shared Supabase project
 *                    (default: the customer name in kebab-case)
 *   --no-comments    turn comments off ("backend": "none")
 *   --keep-examples  keep the template's example prototypes
 *   --site-url       the site address for the README (default: from GITHUB_REPOSITORY)
 *   --force          run even if the site was already set up
 *
 * What it does: removes the example prototypes, writes site.config.json, and replaces
 * README.md with a short one for the customer. Nothing else changes: the viewer, the
 * vendored Vaadin version, CLAUDE.md and SPEC.md stay as they are.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['aura', 'lumo', 'base'];

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      customer: { type: 'string' },
      theme: { type: 'string', default: 'aura' },
      project: { type: 'string' },
      'no-comments': { type: 'boolean', default: false },
      'keep-examples': { type: 'boolean', default: false },
      'site-url': { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  fail(e.message);
}

const configFile = join(root, 'site.config.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
if (!config.template && !args.force) {
  fail(`This site is already set up for "${config.customer}". Use --force to set it up again.`);
}
const customer = (args.customer ?? '').trim();
if (!customer) fail('--customer is required, e.g. --customer "ACME Corp"');
if (!THEMES.includes(args.theme)) fail(`--theme must be one of ${THEMES.join(', ')}`);
const project = (args.project ?? slugify(customer)).trim();
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(project)) fail(`--project must be kebab-case (got "${project}")`);
if (!config.defaultVendor || !existsSync(join(root, 'vendor', config.defaultVendor))) {
  fail(`site.config.json → defaultVendor (${config.defaultVendor}) has no folder under vendor/`);
}

// 1. Example prototypes
const protoDir = join(root, 'prototypes');
const removed = [];
if (!args['keep-examples'] && existsSync(protoDir)) {
  for (const d of readdirSync(protoDir, { withFileTypes: true })) {
    if (d.isDirectory()) {
      rmSync(join(protoDir, d.name), { recursive: true, force: true });
      removed.push(d.name);
    }
  }
}
mkdirSync(protoDir, { recursive: true });
writeFileSync(join(protoDir, '.gitkeep'), '');

// 2. site.config.json
const comments = { ...(config.comments ?? {}) };
if (args['no-comments']) {
  comments.backend = 'none';
} else {
  comments.backend = comments.backend && comments.backend !== 'none' ? comments.backend : 'supabase';
  comments.project = project;
}
const next = {
  customer,
  defaultTheme: args.theme,
  defaultVendor: config.defaultVendor,
  comments,
};
writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`);

// 3. README for the customer's repository
const siteUrl = args['site-url'] ?? pagesUrl();
const commentsOn = comments.backend !== 'none';
const sbReady = commentsOn && comments.supabase?.url && comments.supabase?.publishableKey;
writeFileSync(join(root, 'README.md'), `# Prototypes – ${customer}

Vaadin HTML prototypes for ${customer}${siteUrl ? `, published at ${siteUrl}` : ''}.

- **Add or change a prototype:** ask Claude Code in this repository, e.g. "Create a
  prototype of the order list with bulk actions, two variants". It follows
  [CLAUDE.md](CLAUDE.md) and checks its work in the viewer.
- **Publish:** merge to \`main\`. GitHub Actions deploys the site in a minute or two.
- **Preview locally:** \`npm run serve\` (Node 20+, nothing to install), then open
  http://localhost:8080/.
${commentsOn
    ? `- **Comments:** people sign in on the site with the comment password and their name.
  Comment project id: \`${project}\`.${sbReady ? '' : ' Comment storage isn’t connected yet: open the site\n  at `#/setup` and follow the steps.'} Never commit the password.`
    : '- **Comments:** turned off (`site.config.json` → `comments.backend`: `"none"`).'}

Theme: ${args.theme}. Vaadin: ${config.defaultVendor.replace('vaadin-', '')}. How this site was made from the
template: [docs/new-customer-site.md](docs/new-customer-site.md). Specification: [SPEC.md](SPEC.md).
`);

console.log(`Set up the site for ${customer}.`);
console.log(`  theme ${args.theme}, comments ${commentsOn ? `on (project id "${project}")` : 'off'}`);
console.log(removed.length ? `  removed example prototypes: ${removed.join(', ')}` : '  kept the example prototypes');
console.log('Next: commit and push to main. See docs/new-customer-site.md for the remaining steps.');

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'customer';
}
function pagesUrl() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  return name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${name.toLowerCase()}/` : `https://${owner.toLowerCase()}.github.io/${name}/`;
}
function fail(msg) {
  console.error(`init-site: ${msg}`);
  process.exit(1);
}
