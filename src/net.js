'use strict';
// A deliberately paranoid HTTP client: only public addresses, no cookies,
// no referrer, size and time limits, and every redirect hop is re-checked.

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const zlib = require('node:zlib');
const { FetchError, isPublicAddress, validateTarget, ALLOWED_PORTS } = require('./target');

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  allowedPorts: ALLOWED_PORTS,
  allowPrivate: false, // only ever true in tests
};

// A generic, common user agent so the target cannot single out this service's users.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

/**
 * DNS lookup used at connect time. Checking here (rather than before the request)
 * means the address we validate is the address we connect to, which defeats DNS rebinding.
 */
function makeLookup(opts) {
  return (hostname, options, cb) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(new FetchError('Could not find that site.', 502));
      const ok = opts.allowPrivate ? addresses : addresses.filter((a) => isPublicAddress(a.address));
      if (ok.length === 0 || ok.length !== addresses.length) {
        return cb(new FetchError('That address is not allowed.', 400));
      }
      if (options && options.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}

function requestOnce(u, opts) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'GET',
      lookup: makeLookup(opts),
      agent: false, // no connection reuse between users
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        // No Cookie, no Referer, no client IP forwarding headers. Ever.
        DNT: '1',
        'Sec-GPC': '1',
      },
      timeout: opts.timeoutMs,
    });
    const timer = setTimeout(() => req.destroy(new FetchError('The site took too long to respond.', 504)), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new FetchError('The site took too long to respond.', 504)));
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e instanceof FetchError ? e : new FetchError('Could not reach that site.', 502));
    });
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        res.resume();
        return resolve({ redirect: res.headers.location });
      }
      if (res.statusCode >= 400) {
        clearTimeout(timer);
        res.resume();
        return reject(new FetchError(`The site answered with an error (${res.statusCode}).`, 502));
      }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (!/text\/html|application\/xhtml\+xml/.test(type)) {
        clearTimeout(timer);
        res.resume();
        return reject(new FetchError('That address is not a web page (only HTML can be read).', 415));
      }
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > opts.maxBytes) {
          req.destroy();
          stream.destroy();
          clearTimeout(timer);
          reject(new FetchError('That page is too large to read here.', 413));
        } else chunks.push(c);
      });
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ body: Buffer.concat(chunks), contentType: type });
      });
      stream.on('error', () => {
        clearTimeout(timer);
        reject(new FetchError('The page could not be decoded.', 502));
      });
    });
    req.end();
  });
}

function decode(buf, contentType) {
  let charset = (/charset=([\w-]+)/.exec(contentType) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Fetches a public HTML page. Returns { url, html } where url is the final, cleaned URL. */
async function safeFetch(input, overrides = {}) {
  const opts = { ...DEFAULTS, ...overrides };
  let u = validateTarget(input, opts);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await requestOnce(u, opts);
    if (res.redirect) {
      let next;
      try {
        next = new URL(res.redirect, u);
      } catch {
        throw new FetchError('The site sent a broken redirect.', 502);
      }
      u = validateTarget(next.href, opts);
      continue;
    }
    return { url: u.href, html: decode(res.body, res.contentType) };
  }
  throw new FetchError('Too many redirects.', 508);
}

module.exports = { safeFetch, validateTarget, isPublicAddress, makeLookup, FetchError, DEFAULTS };
