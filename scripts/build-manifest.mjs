#!/usr/bin/env node
/**
 * build-manifest.mjs: writes manifest.json from prototypes/*\/meta.json + git history
 * (docs/SPEC.md §4.3, §5.2). Runs in CI on every deploy and locally before serving.
 *
 *   node scripts/build-manifest.mjs [--out manifest.json] [--strict]
 *
 * - version: SHA of the latest commit that touched prototypes/<slug>/ (needs full
 *   history in CI: actions/checkout with fetch-depth: 0). Uncommitted local changes
 *   are reported as "<sha>+dirty" so local testing still works.
 * - Validates each meta.json and prints problems. Errors (missing vendor folder,
 *   bad slug, unknown theme, ...) fail the build with --strict (used in CI).
 * - Warns about vendor folders no prototype or snapshot uses (§7.2).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outFile = join(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'manifest.json');
const strict = args.includes('--strict');

const THEMES = ['aura', 'lumo', 'base'];
const STATUSES = ['draft', 'in-review', 'approved', 'archived'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

const errors = [];
const warnings = [];
const site = readJson(join(root, 'site.config.json'), 'site.config.json') ?? {};
const protoDir = join(root, 'prototypes');
const slugs = existsSync(protoDir)
  ? readdirSync(protoDir).filter((d) => statSync(join(protoDir, d)).isDirectory() && !d.startsWith('_') && !d.startsWith('.'))
  : [];

const usedVendors = new Set();
const prototypes = [];
for (const slug of slugs.sort()) {
  const dir = join(protoDir, slug);
  const where = `prototypes/${slug}`;
  if (!SLUG.test(slug)) errors.push(`${where}: slug must be kebab-case`);
  if (!existsSync(join(dir, 'index.html'))) errors.push(`${where}: index.html is missing`);
  const meta = readJson(join(dir, 'meta.json'), `${where}/meta.json`);
  if (!meta) continue;

  for (const key of ['title', 'area', 'status', 'vendor', 'theme']) {
    if (!meta[key]) errors.push(`${where}/meta.json: "${key}" is required`);
  }
  if (meta.status && !STATUSES.includes(meta.status)) errors.push(`${where}/meta.json: status must be one of ${STATUSES.join(', ')}`);
  if (meta.theme && !THEMES.includes(meta.theme)) errors.push(`${where}/meta.json: theme must be one of ${THEMES.join(', ')}`);
  if (meta.vendor) {
    usedVendors.add(meta.vendor);
    if (!existsSync(join(root, 'vendor', meta.vendor))) errors.push(`${where}/meta.json: vendor/${meta.vendor} does not exist`);
    else checkVendorReference(join(dir, 'index.html'), meta.vendor, meta.theme, where);
  }
  if (meta.theme && site.defaultTheme && meta.theme !== site.defaultTheme && meta.status !== 'archived') {
    warnings.push(`${where}: uses theme "${meta.theme}", the site default is "${site.defaultTheme}"`);
  }
  for (const [listName, list] of [['variants', meta.variants], ['snapshots', meta.snapshots]]) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`${where}/meta.json: "${listName}" must be an array`); continue; }
    const seen = new Set();
    for (const item of list) {
      if (!item?.id || !ID.test(item.id)) errors.push(`${where}/meta.json: every ${listName} entry needs an id (lowercase, kebab-case)`);
      if (seen.has(item?.id)) errors.push(`${where}/meta.json: duplicate ${listName} id "${item.id}"`);
      seen.add(item?.id);
      if (listName === 'snapshots' && item?.id) {
        if (!existsSync(join(dir, item.id, 'index.html'))) errors.push(`${where}: snapshot ${item.id}/index.html is missing`);
        const snapVendor = item.vendor ?? sniffVendor(join(dir, item.id, 'index.html'));
        if (snapVendor) usedVendors.add(snapVendor);
      }
    }
  }

  const git = gitInfo(`prototypes/${slug}`);
  prototypes.push({
    slug,
    path: `prototypes/${slug}/`,
    version: git.version,
    updated: git.updated,
    ...meta,
    variants: meta.variants ?? [],
    snapshots: meta.snapshots ?? [],
  });
}

const vendorRoot = join(root, 'vendor');
if (existsSync(vendorRoot)) {
  for (const v of readdirSync(vendorRoot)) {
    // The default vendor is what new prototypes use, so it's never "unused".
    if (statSync(join(vendorRoot, v)).isDirectory() && !usedVendors.has(v) && v !== site.defaultVendor) {
      warnings.push(`vendor/${v} is not used by any prototype or snapshot; remove it (§7.2)`);
    }
  }
}

const manifest = {
  generated: new Date().toISOString(),
  customer: site.customer ?? '',
  defaultTheme: site.defaultTheme ?? 'aura',
  prototypes,
};
writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(`manifest.json: ${prototypes.length} prototype(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
if (strict && errors.length) process.exit(1);

function readJson(file, label) {
  if (!existsSync(file)) { errors.push(`${label} is missing`); return null; }
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { errors.push(`${label}: invalid JSON (${e.message})`); return null; }
}

/** The page must load the vendor version and theme that meta.json declares. */
function checkVendorReference(htmlFile, vendor, theme, where) {
  if (!existsSync(htmlFile)) return;
  const html = readFileSync(htmlFile, 'utf8');
  if (!html.includes(`vendor/${vendor}/vaadin.js`)) errors.push(`${where}/index.html does not load vendor/${vendor}/vaadin.js`);
  if (theme && !html.includes(`vendor/${vendor}/${theme}.css`)) errors.push(`${where}/index.html does not load vendor/${vendor}/${theme}.css`);
  const other = [...html.matchAll(/vendor\/(vaadin-[\w.-]+)\//g)].map((m) => m[1]).filter((v) => v !== vendor);
  if (other.length) errors.push(`${where}/index.html references another vendor version: ${[...new Set(other)].join(', ')}`);
  if (/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html)) errors.push(`${where}/index.html loads something from an external URL`);
}

function sniffVendor(htmlFile) {
  if (!existsSync(htmlFile)) return null;
  return readFileSync(htmlFile, 'utf8').match(/vendor\/(vaadin-[\w.-]+)\//)?.[1] ?? null;
}

function gitInfo(path) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%H %cI', '--', path], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', path], { cwd: root, encoding: 'utf8' }).trim() !== '';
    if (!out) return { version: 'uncommitted', updated: null };
    const [sha, date] = out.split(' ');
    return { version: dirty ? `${sha}+dirty` : sha, updated: date };
  } catch {
    warnings.push(`git history not available for ${path}`);
    return { version: 'unknown', updated: null };
  }
}
