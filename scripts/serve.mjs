#!/usr/bin/env node
/**
 * serve.mjs: a dependency-free static server for local testing. It serves the repo
 * root with the same layout as GitHub Pages (/ = viewer, /prototypes, /vendor,
 * /manifest.json).
 *
 *   node scripts/serve.mjs [port] [--pages]     (default port 8080, or $PORT)
 *
 * Files are revalidated on every request (Last-Modified / 304), so edits show up on
 * reload. --pages mimics GitHub Pages caching instead (max-age=600 plus 304s), which
 * is what the prototype-switch timing in §7.1 should be measured against.
 *
 * Run `node scripts/build-manifest.mjs` first (or `npm run serve`, which does both).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pagesMode = args.includes('--pages');
const port = Number(args.find((a) => !a.startsWith('--')) ?? process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root) || file.split(sep).includes('.git')) return send(res, 403, 'Forbidden');
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: path + '/' }); return res.end(); }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) return send(res, 404, 'Not found');
  const mtime = statSync(file).mtime;
  mtime.setMilliseconds(0);
  const headers = {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': pagesMode ? 'max-age=600' : 'no-cache',
    'Last-Modified': mtime.toUTCString(),
  };
  const since = req.headers['if-modified-since'];
  if (since && new Date(since) >= mtime) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/${pagesMode ? ' (GitHub Pages caching)' : ''}`));

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(text);
}
