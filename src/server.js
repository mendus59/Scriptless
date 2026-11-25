'use strict';
// Scriptless HTTP server. Built on node:http directly so there is no
// framework middleware that could log, set cookies or add headers behind our back.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { safeFetch, FetchError } = require('./net');
const { fetchWithFallback } = require('./archive');
const { extract } = require('./extract');
const render = require('./render');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'));
const MAX_BODY = 8 * 1024;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 16);

const { SECURITY_HEADERS } = require('./headers');

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new FetchError('Request too large.', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new FetchError('Please paste a web address.', 400);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s; // allow "example.com/article"
  return s;
}

let active = 0;

async function handleRead(req, res, rawUrl, fetchOpts) {
  if (active >= MAX_CONCURRENT) return send(res, 503, render.error('Scriptless is busy right now. Please try again in a moment.'), undefined, { 'Retry-After': '5' });
  active++;
  try {
    const { url, html, archived } = await fetchWithFallback((u, o = {}) => safeFetch(u, { ...fetchOpts, ...o }), normalizeInput(rawUrl));
    send(res, 200, render.article(extract(html, url), url, { archived }));
  } catch (e) {
    const status = e instanceof FetchError ? e.status : 500;
    const msg = e instanceof FetchError ? e.message : 'Something went wrong while reading that page.';
    send(res, status, render.error(msg));
  } finally {
    active--;
  }
}

function createServer({ fetchOpts = {} } = {}) {
  return http.createServer(async (req, res) => {
    // Intentionally no logging of any kind: no IPs, no URLs, no timings.
    let u;
    try {
      u = new URL(req.url, 'http://local');
    } catch {
      return send(res, 400, render.error('Bad request.'));
    }
    try {
      if (req.method === 'GET' && u.pathname === '/') return send(res, 200, render.home());
      if (req.method === 'GET' && u.pathname === '/about') return send(res, 200, render.about());
      if (req.method === 'GET' && u.pathname === '/style.css') {
        return send(res, 200, CSS, 'text/css; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
      }
      if (req.method === 'GET' && u.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain; charset=utf-8');
      if (u.pathname === '/read') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          return handleRead(req, res, new URLSearchParams(body).get('url'), fetchOpts);
        }
        if (req.method === 'GET') return handleRead(req, res, u.searchParams.get('url'), fetchOpts);
        return send(res, 405, render.error('Method not allowed.'), undefined, { Allow: 'GET, POST' });
      }
      if (req.method === 'GET' && u.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
      return send(res, 404, render.error('There is nothing here.'));
    } catch (e) {
      const status = e instanceof FetchError ? e.status : 500;
      return send(res, status, render.error(e instanceof FetchError ? e.message : 'Something went wrong.'));
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.listen(port, host, () => {
    process.stdout.write(`Scriptless listening on http://${host}:${port}\n`);
  });
}

module.exports = { createServer, SECURITY_HEADERS };
