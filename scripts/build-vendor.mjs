#!/usr/bin/env node
/**
 * build-vendor.mjs: bundles the Vaadin web components and the theme CSS from npm
 * into vendor/vaadin-<version>/ (docs/SPEC.md §7, §7.1, §7.2).
 *
 *   node scripts/build-vendor.mjs [version] [--force]
 *
 * Run it only when deliberately adding a new Vaadin version. It never touches an
 * existing vendor folder unless --force is given. Needs Node 20+ and access to the
 * npm registry. Nothing is installed in the repository: packages and esbuild go to
 * a temporary directory that is removed afterwards.
 *
 * Output (all files are committed):
 *   vaadin.js                     every free Vaadin web component in one minified ES module
 *   aura.css + fonts/             the Aura theme (Instrument Sans font as a separate file)
 *   lumo.css                      the Lumo theme (its icon font is inlined by Vaadin)
 *   lumo-utility.css              optional Lumo utility classes (Lumo only)
 *   base.css                      page font + colors for base styles, see "Base styles" below
 *   build-info.json               version, package list, sizes
 *   LICENSE-*.txt                 Apache-2.0 licence texts of the bundled packages
 *
 * ---------------------------------------------------------------------------------
 * What was checked for Vaadin 25.3.7 (2026-11-26, npm registry + vaadin.com/docs v25.3)
 * ---------------------------------------------------------------------------------
 * Versions
 *   - The web component packages (@vaadin/button, @vaadin/grid, ...) and the theme
 *     packages are released together; latest stable is 25.3.7. The umbrella package
 *     @vaadin/vaadin-core is 25.3.6 but depends on the 25.3.7 components. We don't use
 *     vaadin-core because it also pulls in @vaadin/router and the usage statistics;
 *     the component list below is taken from its dependencies instead.
 *
 * Theme packages and how each one is loaded
 *   - Aura:  npm "@vaadin/aura", stylesheet "@vaadin/aura/aura.css" (pure CSS, no JS).
 *            Uses a woff2 font file (fonts/InstrumentSans/InstrumentSans.woff2).
 *   - Lumo:  npm "@vaadin/vaadin-lumo-styles", stylesheet
 *            "@vaadin/vaadin-lumo-styles/lumo.css" (pure CSS in Vaadin 25; its icon
 *            font is a data: URI). Utility classes are a separate stylesheet,
 *            "@vaadin/vaadin-lumo-styles/utility.css", not loaded by default.
 *   - Base styles: there is NO separate package or stylesheet. Since Vaadin 25 every
 *            component ships minimal built-in "base styles" in its JS, which apply
 *            whenever no theme stylesheet is loaded. They style the components only,
 *            so base.css adds the page font and the page background/text colors from
 *            the base tokens (otherwise the page is serif and stays white in dark
 *            mode). It contains no component styles.
 *
 * Light / dark mechanism (used by viewer/theme-adapters.js)
 *   - Aura:  the CSS `color-scheme` property on <html>: `light` (default), `dark`, or
 *            `light dark` (follow the OS). All Aura colors use light-dark().
 *   - Base:  same as Aura. The base styles use light-dark() too
 *            (component-base/src/styles/style-props.js), so `color-scheme` decides.
 *   - Lumo:  also the `color-scheme` property. Lumo 25 defines its colors with
 *            light-dark() on :root (lumo/src/props/color.css), so `color-scheme: dark`
 *            on <html> switches everything; verified in Chromium, including the
 *            registered --vaadin-* properties and when set before first paint.
 *            Lumo still has its older switch, theme="dark" on <html> ([theme~='dark']
 *            in lumo/src/global/color-scheme.css), which Flow's ColorScheme.DARK adds
 *            "for backwards compatibility". It isn't used: its higher specificity
 *            overrides a page's own `html { --lumo-*: light-dark(...) }` dark colors.
 *
 * Left out on purpose
 *   - Commercial components (charts, grid-pro, crud, rich-text-editor, board,
 *     dashboard, map, cookie-consent, spreadsheet): licence and size (§7.1). If a
 *     prototype needs one, add a separate optional bundle loaded only by it.
 *   - @vaadin/router, @vaadin/field-highlighter (Collaboration Engine only).
 *   - @vaadin/vaadin-usage-statistics: component-base imports it, and in "development
 *     mode" (localhost, unminified) it POSTs to tools.vaadin.com. Prototypes must make
 *     no external requests (§4.1), so it is replaced with a no-op stub at bundle time.
 * ---------------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const DEFAULT_VERSION = '25.3.7';
const ESBUILD_VERSION = '0.25.12';

// Free (Apache-2.0) component packages, from @vaadin/vaadin-core's dependencies.
const COMPONENT_PACKAGES = [
  'accordion', 'app-layout', 'avatar', 'avatar-group', 'badge', 'breadcrumbs', 'button', 'card',
  'checkbox', 'checkbox-group', 'combo-box', 'confirm-dialog', 'context-menu', 'custom-field',
  'date-picker', 'date-time-picker', 'details', 'dialog', 'email-field', 'form-layout', 'grid',
  'horizontal-layout', 'icon', 'icons', 'integer-field', 'item', 'list-box', 'login', 'markdown',
  'master-detail-layout', 'menu-bar', 'message-input', 'message-list', 'multi-select-combo-box',
  'notification', 'number-field', 'password-field', 'popover', 'progress-bar', 'radio-group',
  'scroller', 'select', 'side-nav', 'slider', 'split-layout', 'switch', 'tabs', 'tabsheet',
  'text-area', 'text-field', 'time-picker', 'tooltip', 'upload', 'vertical-layout', 'virtual-list',
];
const THEME_PACKAGES = ['aura', 'vaadin-lumo-styles'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const version = args.find((a) => !a.startsWith('--')) ?? DEFAULT_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Not a stable version: ${version}`);

const outDir = join(root, 'vendor', `vaadin-${version}`);
if (existsSync(outDir) && !force) {
  fail(`${relative(root, outDir)} already exists. Vendor folders are immutable (§7); pass --force to rebuild it.`);
}

const work = mkdtempSync(join(tmpdir(), 'vaadin-vendor-'));
try {
  console.log(`Installing Vaadin ${version} packages into ${work} ...`);
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'vendor-build', private: true, type: 'module' }));
  const specs = [...COMPONENT_PACKAGES, ...THEME_PACKAGES].map((p) => `@vaadin/${p}@${version}`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...specs, `esbuild@${ESBUILD_VERSION}`], {
    cwd: work,
    stdio: 'inherit',
  });
  const nm = join(work, 'node_modules');
  const esbuild = await import(pathToFileURL(join(nm, 'esbuild', 'lib', 'main.js')).href);

  // Check that npm resolved every @vaadin package to the requested version
  // (a mismatch would mean two copies of a base class in the bundle).
  const mismatched = readdirSync(join(nm, '@vaadin'))
    .map((p) => [p, JSON.parse(readFileSync(join(nm, '@vaadin', p, 'package.json'), 'utf8')).version])
    .filter(([p, v]) => v !== version && !['vaadin-usage-statistics', 'vaadin-development-mode-detector'].includes(p));
  if (mismatched.length) fail(`Packages not on ${version}: ${mismatched.map((m) => m.join('@')).join(', ')}`);

  // Entry module: every public element module (vaadin-*.js in each package root).
  const imports = [];
  for (const p of COMPONENT_PACKAGES) {
    const files = readdirSync(join(nm, '@vaadin', p)).filter((f) => /^vaadin-.*\.js$/.test(f) && !f.includes('mixin'));
    if (!files.length) fail(`@vaadin/${p} has no vaadin-*.js element module`);
    for (const f of files) imports.push(`import '@vaadin/${p}/${f}';`);
  }
  // Lumo's own iconset (lumo:*) so Lumo prototypes can use the same icons as the theme.
  imports.push(`import '@vaadin/vaadin-lumo-styles/vaadin-iconset.js';`);
  writeFileSync(join(work, 'entry.js'), imports.join('\n') + '\n');

  const noUsageStats = {
    name: 'no-usage-statistics',
    setup(build) {
      build.onResolve({ filter: /^@vaadin\/vaadin-usage-statistics/ }, () => ({ path: 'stub', namespace: 'no-usage-stats' }));
      build.onLoad({ filter: /.*/, namespace: 'no-usage-stats' }, () => ({ contents: 'export function usageStatistics() {}' }));
    },
  };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  console.log('Bundling components ...');
  await esbuild.build({
    entryPoints: [join(work, 'entry.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
    plugins: [noUsageStats],
    outfile: join(outDir, 'vaadin.js'),
    logLevel: 'warning',
  });

  console.log('Bundling theme stylesheets ...');
  const css = [
    ['aura.css', join(nm, '@vaadin/aura/aura.css')],
    ['lumo.css', join(nm, '@vaadin/vaadin-lumo-styles/lumo.css')],
    ['lumo-utility.css', join(nm, '@vaadin/vaadin-lumo-styles/utility.css')],
  ];
  for (const [name, entry] of css) {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      legalComments: 'none',
      loader: { '.woff2': 'file', '.woff': 'file' },
      assetNames: 'fonts/[name]',
      outfile: join(outDir, name),
      logLevel: 'warning',
    });
  }
  writeFileSync(
    join(outDir, 'base.css'),
    `/* Vaadin ${version} base styles.\n` +
      ' * The component base styles are built into each component (vaadin.js) and apply\n' +
      ' * whenever no theme stylesheet is loaded. They style the components only, so this\n' +
      ' * file gives the page a font and the base background/text colors. Light/dark:\n' +
      ' * the color-scheme property on <html>. */\n' +
      'html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'background-color:var(--vaadin-background-color);color:var(--vaadin-text-color)}\n',
  );

  for (const [file, pkg] of [['LICENSE-vaadin-components.txt', 'button'], ['LICENSE-aura.txt', 'aura'], ['LICENSE-lumo.txt', 'vaadin-lumo-styles']]) {
    copyFileSync(join(nm, '@vaadin', pkg, 'LICENSE'), join(outDir, file));
  }
  const fontLicense = findFile(join(nm, '@vaadin/aura'), /OFL|LICENSE.*\.txt$/i, 'fonts');
  if (fontLicense) copyFileSync(fontLicense, join(outDir, 'LICENSE-InstrumentSans.txt'));

  // No external requests: no absolute URLs in url()/@import, no remote imports in JS.
  for (const f of listFiles(outDir)) {
    const text = f.endsWith('.css') || f.endsWith('.js') ? readFileSync(f, 'utf8') : '';
    if (f.endsWith('.css') && /url\(\s*['"]?(https?:)?\/\//i.test(text)) fail(`${f} references an external URL`);
    if (f.endsWith('.css') && /@import/i.test(text)) fail(`${f} still contains @import`);
    if (f.endsWith('.js') && /(import\s*\(|from)\s*['"`]https?:/i.test(text)) fail(`${f} imports from an external URL`);
    if (f.endsWith('.js') && text.includes('tools.vaadin.com')) fail(`${f} still contains the usage statistics sender`);
  }

  // Sizes (§7.1).
  const rows = listFiles(outDir)
    .filter((f) => !/LICENSE|build-info/.test(f))
    .map((f) => {
      const buf = readFileSync(f);
      return { file: relative(outDir, f), bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
    });
  const info = {
    version,
    built: new Date().toISOString(),
    builtWith: `esbuild ${ESBUILD_VERSION}, node ${process.version}`,
    themes: { aura: 'aura.css', lumo: 'lumo.css', base: 'base.css' },
    optional: { 'lumo-utility': 'lumo-utility.css' },
    packages: COMPONENT_PACKAGES.map((p) => `@vaadin/${p}`),
    themePackages: THEME_PACKAGES.map((p) => `@vaadin/${p}`),
    sizes: rows,
  };
  writeFileSync(join(outDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  console.log(`\nvendor/vaadin-${version}/  (minified / gzip -9)`);
  const w = Math.max(...rows.map((r) => r.file.length));
  for (const r of rows) console.log(`  ${r.file.padEnd(w)}  ${kb(r.bytes).padStart(10)}  ${kb(r.gzip).padStart(10)}`);
  const total = rows.reduce((a, r) => ({ bytes: a.bytes + r.bytes, gzip: a.gzip + r.gzip }), { bytes: 0, gzip: 0 });
  console.log(`  ${'total'.padEnd(w)}  ${kb(total.bytes).padStart(10)}  ${kb(total.gzip).padStart(10)}`);
  console.log('\nNote: a prototype downloads vaadin.js plus one theme file (and the Aura font if Aura).');
} finally {
  rmSync(work, { recursive: true, force: true });
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)],
  ).sort();
}
function findFile(dir, re, within) {
  if (!existsSync(dir)) return null;
  for (const f of listFiles(dir)) if (f.includes(within) && re.test(f)) return f;
  return null;
}
function fail(msg) {
  console.error(`build-vendor: ${msg}`);
  process.exit(1);
}
