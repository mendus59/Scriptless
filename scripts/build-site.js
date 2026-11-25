'use strict';
// Builds the static GitHub Pages front door into ./_site.
// Usage: SCRIPTLESS_WORKER_URL=https://scriptless.<you>.workers.dev node scripts/build-site.js
//
// The pages are plain HTML with no JavaScript. Their forms post straight to the Worker,
// which fetches the article and returns the reading page itself.

const fs = require('node:fs');
const path = require('node:path');
const render = require('../src/render');

const raw = process.env.SCRIPTLESS_WORKER_URL;
if (!raw) {
  console.error('Set SCRIPTLESS_WORKER_URL to your Worker address, e.g. https://scriptless.example.workers.dev');
  process.exit(1);
}
const worker = new URL(raw);
const isLocal = worker.hostname === '127.0.0.1' || worker.hostname === 'localhost';
if (worker.protocol !== 'https:' && !isLocal) {
  console.error('SCRIPTLESS_WORKER_URL must be an https address.');
  process.exit(1);
}
const origin = worker.origin;

// GitHub Pages cannot set response headers, so the policy goes in a meta tag.
// (frame-ancestors and sandbox are ignored in meta; the Worker's own pages send them as headers.)
const csp = [
  "default-src 'none'", "style-src 'self'", "img-src 'none'", "script-src 'none'", "connect-src 'none'",
  "font-src 'none'", "object-src 'none'", "base-uri 'none'", `form-action ${origin}`,
].join('; ');

const links = {
  home: './',
  about: './about.html',
  css: './style.css',
  read: `${origin}/read`,
  cspMeta: `\n<meta http-equiv="Content-Security-Policy" content="${csp}">`,
};

const out = path.join(__dirname, '..', '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
// The front door is meant to be found, so unlike reading pages it may be indexed.
const indexable = (html) => html.replace('<meta name="robots" content="noindex, nofollow">\n', '');
fs.writeFileSync(path.join(out, 'index.html'), indexable(render.home(links)));
fs.writeFileSync(path.join(out, 'about.html'), indexable(render.about(links)));
fs.copyFileSync(path.join(__dirname, '..', 'public', 'style.css'), path.join(out, 'style.css'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built _site with forms posting to ${origin}/read`);
