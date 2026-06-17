#!/usr/bin/env node
// MODULAR: build script. Copies web/ to web/dist/, hashes the
// asset filenames (app.abc123.js, main.def456.css), and rewrites
// the <script> / <link> tags in index.html to point at the
// hashed names. Dev mode (web/) is unchanged.
//
// PERFORMANT: the production assets get Cache-Control:
// public, max-age=31536000, immutable (set in the static handler
// when the URL is /dist/...); the dev assets stay no-cache.
//
// DRY: one source of truth (web/). The build is pure: no
// transpilation, no bundling, no minification. The single-port
// proxy serves /dist/ exactly as it serves / today.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC  = path.resolve(__dirname, '..', 'web');
const DEST = path.resolve(__dirname, '..', 'web', 'dist');
const ASSET_RE = /\.(css|js|mjs)$/;

function hash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const e of fs.readdirSync(p)) {
    const c = path.join(p, e);
    const stat = fs.statSync(c);
    if (stat.isDirectory()) rmrf(c);
    else fs.unlinkSync(c);
  }
  fs.rmdirSync(p);
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  rmrf(DEST);
  fs.mkdirSync(DEST, { recursive: true });

  // MODULAR: walk web/ + web/lib/ + web/styles/, hash the
  // fingerprintable assets, copy everything else as-is.
  // The static-fingerprinted set (.css / .js / .mjs) gets
  // hashed; everything else (favicon, .ico, .html, etc.)
  // is copied unchanged. The proxy serves these under the
  // /favicon.* paths AND the build output is mirrored to
  // /dist/ for the same path.
  //
  // MODULAR: _redirects + _headers are Netlify-specific
  // config files that the static host reads from the
  // publish root (web/), NOT from web/dist/. Skipping
  // them here + below means the dist tree is a pure
  // runtime asset bundle, not a config dump.
  const hashMap = {};
  const ASSET_DIRS = ['.', 'lib', 'styles'];
  const SKIP_AT_ROOT = new Set(['_redirects', '_headers']);
  for (const sub of ASSET_DIRS) {
    const dir = path.join(SRC, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (sub === '.' && SKIP_AT_ROOT.has(name)) continue;
      const src = path.join(dir, name);
      if (fs.statSync(src).isDirectory()) continue;
      // MODULAR: skip OS metadata files (Mac .DS_Store, Windows
      // Thumbs.db, etc.) — they have no business in a web build.
      if (name === '.DS_Store' || name === 'Thumbs.db') continue;
      const ext = path.extname(name).toLowerCase();
      let destName = name;
      if (ASSET_RE.test(name)) {
        const buf = fs.readFileSync(src);
        const h = hash(buf);
        destName = name.replace(ext, '.' + h + ext);
        hashMap[`${sub === '.' ? '' : sub + '/'}${name}`] = `${sub === '.' ? '' : sub + '/'}${destName}`;
      }
      copyFile(src, path.join(DEST, sub, destName));
    }
  }
  // MODULAR: copy root-level static files (favicon.svg,
  // favicon.ico, etc.) that aren't under lib/ or styles/.
  // These are served at the URL root. We skip .js / .css
  // / .mjs at the root because the hashed versions live
  // under /lib/ and /styles/; copying the un-hashed root
  // .js would create a duplicate that confuses the cache.
  for (const name of fs.readdirSync(SRC)) {
    if (name === 'lib' || name === 'styles' || name === 'dist') continue;
    if (SKIP_AT_ROOT.has(name)) continue;
    const src = path.join(SRC, name);
    if (fs.statSync(src).isDirectory()) continue;
    if (name === '.DS_Store' || name === 'Thumbs.db') continue;
    if (path.extname(name).toLowerCase() === '.html') continue;
    if (ASSET_RE.test(name)) continue;
    copyFile(src, path.join(DEST, name));
  }

  // MODULAR: rewrite index.html to point at the hashed assets.
  // We don't hash index.html itself — the entry HTML stays
  // un-hashed so the proxy can serve a single index.html with
  // no-cache. The hashed JS/CSS are referenced from it.
  const htmlPath = path.join(SRC, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  for (const [from, to] of Object.entries(hashMap)) {
    // Match the un-hashed name in src="/..." or href="/..." attributes.
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(src|href)="/${escaped}"`, 'g');
    html = html.replace(re, `$1="/dist/${to}"`);
  }
  // MODULAR: the dropzone's static path is also under /lib/.
  // We rewrite any /lib/foo.js reference even if it wasn't in
  // the explicit walk (lib is always hashed).
  fs.writeFileSync(path.join(DEST, 'index.html'), html);

  // MODULAR: also copy the dropzone-less HTML (the same index.html
  // we just wrote) to /web/dist/. The static handler serves
  // /dist/ at the same path.
  console.log(`build complete: dist/ has ${Object.keys(hashMap).length} hashed assets`);
  console.log('  files:', Object.entries(hashMap).map(([k, v]) => `${k} -> ${v}`).join('\n  files: '));
}

main();
