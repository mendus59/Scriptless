// Scriptless as a Cloudflare Worker. Same extraction, sanitizing and pages as the
// Node server; the fetch side uses the Workers runtime instead of node:http.
//
// Workers cannot reach private networks, and every redirect hop is re-validated here,
// so the SSRF rules from the Node server still hold.

import { validateTarget, FetchError, BROWSER_HEADERS } from './target.js';
import { fetchWithFallback } from './archive.js';
import { extract } from './extract.js';
import * as render from './render.js';
import { SECURITY_HEADERS } from './headers.js';
import CSS from '../public/style.css';

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function respond(body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra },
  });
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FetchError('That page is too large to read here.', 413);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

function decode(buf, contentType) {
  let charset = (/charset=([\w-]+)/.exec(contentType) || [])[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function safeFetch(input) {
  let u = validateTarget(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetch(u.href, {
        method: 'GET',
        redirect: 'manual',
        // A fresh request: no cookies, no referrer, nothing from the reader's own request.
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new FetchError('The site took too long to respond.', 504);
      throw new FetchError('Could not reach that site.', 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next;
      try {
        next = new URL(res.headers.get('location'), u);
      } catch {
        throw new FetchError('The site sent a broken redirect.', 502);
      }
      u = validateTarget(next.href);
      continue;
    }
    if (res.status >= 400) throw new FetchError(`The site answered with an error (${res.status}).`, 502, res.status);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|application\/xhtml\+xml/.test(type)) {
      throw new FetchError('That address is not a web page (only HTML can be read).', 415);
    }
    return { url: u.href, html: decode(await readLimited(res), type) };
  }
  throw new FetchError('Too many redirects.', 508);
}

function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new FetchError('Please paste a web address.', 400);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  return s;
}

async function handleRead(raw) {
  try {
    const { url, html, archived } = await fetchWithFallback(safeFetch, normalizeInput(raw));
    return respond(render.article(extract(html, url), url, { archived }));
  } catch (e) {
    const fe = e instanceof FetchError;
    return respond(render.error(fe ? e.message : 'Something went wrong while reading that page.'), fe ? e.status : 500);
  }
}

export default {
  // No logging, no analytics, no storage bindings. Nothing about a request outlives it.
  async fetch(request) {
    const u = new URL(request.url);
    const m = request.method;
    if (m === 'GET' && u.pathname === '/') return respond(render.home());
    if (m === 'GET' && u.pathname === '/about') return respond(render.about());
    if (m === 'GET' && u.pathname === '/style.css') {
      return respond(CSS, 200, 'text/css; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
    }
    if (m === 'GET' && u.pathname === '/healthz') return respond('ok', 200, 'text/plain; charset=utf-8');
    if (m === 'GET' && u.pathname === '/robots.txt') return respond('User-agent: *\nDisallow: /\n', 200, 'text/plain; charset=utf-8');
    if (u.pathname === '/read') {
      if (m === 'POST') {
        const len = Number(request.headers.get('content-length') || 0);
        if (len > 8192) return respond(render.error('Request too large.'), 413);
        let form;
        try {
          form = await request.formData();
        } catch {
          return respond(render.error('Bad request.'), 400);
        }
        return handleRead(form.get('url'));
      }
      if (m === 'GET') return handleRead(u.searchParams.get('url'));
      return respond(render.error('Method not allowed.'), 405, undefined, { Allow: 'GET, POST' });
    }
    return respond(render.error('There is nothing here.'), 404);
  },
};
