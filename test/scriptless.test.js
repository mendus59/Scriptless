'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { isPublicAddress, validateTarget, safeFetch } = require('../src/net');
const { cleanUrl } = require('../src/clean-url');
const { extract } = require('../src/extract');
const { createServer } = require('../src/server');

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

test('public address check', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPublicAddress(a), false, a);
  }
  for (const a of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(a), true, a);
  assert.equal(isPublicAddress('not-an-ip'), false);
});

test('target validation rejects internal and odd targets', () => {
  const bad = ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[::ffff:7f00:1]/',
    'http://169.254.169.254/latest/meta-data', 'http://localhost/', 'http://foo.localhost/', 'http://printer.local/',
    'file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'http://example.com:22/', 'javascript:alert(1)', 'nonsense'];
  for (const u of bad) assert.throws(() => validateTarget(u), u);
  assert.equal(validateTarget('https://example.com/a').href, 'https://example.com/a');
});

test('safeFetch refuses loopback even via a hostname that resolves there', async () => {
  await assert.rejects(safeFetch('http://localhost/'), /not allowed/);
  await assert.rejects(safeFetch('http://127.0.0.1/'), /not allowed/);
});

test('tracking parameters are stripped', () => {
  const u = cleanUrl('https://user:pw@news.example/a?id=7&utm_source=x&utm_medium=y&fbclid=abc&gclid=1&ref_src=t&_hsenc=q&page=2#xtor=RSS');
  assert.equal(u.href, 'https://news.example/a?id=7&page=2');
});

test('extraction drops scripts, frames, images, handlers and unsafe links', () => {
  const html = `<html><head><title>T</title><script>alert(1)</script><link rel=stylesheet href=//evil/x.css></head><body>
    <nav>menu</nav><article><h1>Hello world</h1>
    <p onclick="steal()">${'Real article text. '.repeat(30)}<a href="javascript:alert(1)">bad</a> <a href="/next?utm_source=z&x=1">next</a></p>
    <img src="https://tracker.example/pixel.gif" alt="A chart"><img src="https://t.example/1x1.gif">
    <iframe src="https://ads.example"></iframe><style>body{background:url(//evil)}</style>
    <p style="background:url(//evil)">${'More words here for the extractor. '.repeat(20)}</p>
    <svg><a href="https://x"><text>svg</text></a></svg><form action="https://phish"><input name=p></form>
    </article></body></html>`;
  const a = extract(html, 'https://site.example/story');
  const c = a.content;
  for (const bad of ['<script', 'alert', 'onclick', '<iframe', '<img', 'src=', 'style', 'tracker.example', 'javascript:', '<svg', '<form', '<input', 'phish']) {
    assert.ok(!c.toLowerCase().includes(bad), `content contains ${bad}`);
  }
  assert.ok(c.includes('[Image: A chart]'));
  assert.ok(c.includes('href="/read?url=https%3A%2F%2Fsite.example%2Fnext%3Fx%3D1"'), c);
  assert.ok(c.includes('Real article text.'));
});

test('end to end: privacy headers, no cookies, nothing forwarded to the target', async () => {
  let seen;
  const target = http.createServer((req, res) => {
    seen = req.headers;
    if (req.url === '/hop') { res.writeHead(302, { Location: '/article?utm_campaign=x' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'track=1' });
    res.end(`<html><head><title>Story</title></head><body><article><h1>Story</h1><p>${'Words worth reading. '.repeat(40)}</p></article></body></html>`);
  });
  const tport = await listen(target);
  const app = createServer({ fetchOpts: { allowPrivate: true, allowedPorts: new Set(['', '80', '443', String(tport)]) } });
  const aport = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${aport}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'mine=secret', Referer: 'https://me.example/' },
      body: new URLSearchParams({ url: `http://127.0.0.1:${tport}/hop` }),
    });
    const body = await res.text();
    assert.equal(res.status, 200, body);
    assert.ok(body.includes('Words worth reading.'));
    assert.ok(!/<script/i.test(body));
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'none'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    // Target saw neither the user's cookie, referrer, nor any forwarding header.
    for (const h of ['cookie', 'referer', 'x-forwarded-for', 'forwarded', 'x-real-ip']) assert.equal(seen[h], undefined, h);
    assert.match(seen['user-agent'], /Firefox/);
    // Redirect target had its tracking param removed before fetch.
    assert.ok(body.includes(`127.0.0.1:${tport}/article<`) || body.includes(`/article"`), 'final url shown without utm');
    assert.ok(!body.includes('utm_campaign'));

    // Non-HTML is refused.
    const bad = await fetch(`http://127.0.0.1:${aport}/read?url=` + encodeURIComponent('file:///etc/passwd'));
    assert.equal(bad.status, 400);
  } finally {
    app.close();
    target.close();
  }
});

test('production defaults block a redirect to an internal address', async () => {
  // Public-looking first hop is impossible offline, so check the redirect validator directly.
  assert.throws(() => validateTarget(new URL('http://169.254.169.254/', 'https://example.com/').href), /not allowed/);
});

test('connect-time DNS check rejects names that resolve to internal addresses', async () => {
  const { makeLookup, DEFAULTS } = require('../src/net');
  const err = await new Promise((r) => makeLookup(DEFAULTS)('localhost', {}, (e) => r(e)));
  assert.match(String(err && err.message), /not allowed/);
});

test('static Pages build points forms at the Worker and ships no scripts', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-site.js')], {
    env: { ...process.env, SCRIPTLESS_WORKER_URL: 'https://reader.example.workers.dev' },
  });
  const site = path.join(__dirname, '..', '_site');
  for (const f of ['index.html', 'about.html']) {
    const html = fs.readFileSync(path.join(site, f), 'utf8');
    assert.ok(!/<script/i.test(html), f);
    assert.match(html, /form-action https:\/\/reader\.example\.workers\.dev/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
  }
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /action="https:\/\/reader\.example\.workers\.dev\/read"/);
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-site.js')], {
    env: { ...process.env, SCRIPTLESS_WORKER_URL: 'http://insecure.example' }, stdio: 'pipe',
  }));
});

test('blocked sites fall back to the Internet Archive copy', async () => {
  const { fetchWithFallback, archiveUrl } = require('../src/archive');
  const { FetchError } = require('../src/target');
  const now = new Date('2026-11-25T07:30:00Z');
  const asked = [];
  const fake = async (u) => {
    asked.push(u);
    if (u.startsWith('https://news.example/')) throw new FetchError('blocked', 502, 403);
    return { url: 'https://web.archive.org/web/20261117083000id_/https://news.example/story', html: '<p>archived</p>' };
  };
  const r = await fetchWithFallback(fake, 'https://news.example/story?utm_source=x', now);
  assert.equal(r.archived, '2026-11-17');
  assert.equal(r.url, 'https://news.example/story');
  assert.equal(r.html, '<p>archived</p>');
  assert.deepEqual(asked, ['https://news.example/story?utm_source=x', archiveUrl('https://news.example/story', now)]);
  assert.equal(archiveUrl('https://news.example/story', now), 'https://web.archive.org/web/20261125073000id_/https://news.example/story');

  // A page that simply does not exist is not retried through the Archive.
  const notFound = async () => { throw new FetchError('missing', 502, 404); };
  await assert.rejects(fetchWithFallback(notFound, 'https://news.example/x'), /missing/);

  // Blocked and not archived: a clear message naming the site.
  const neither = async () => { throw new FetchError('blocked', 502, 403); };
  await assert.rejects(fetchWithFallback(neither, 'https://www.news.example/x'), /news\.example refused .*Internet Archive has no copy/);
});

test('archived pages say so', () => {
  const render = require('../src/render');
  const html = render.article({ title: 'T', content: '<p>x</p>', textLength: 500 }, 'https://news.example/a', { archived: '2026-11-17' });
  assert.match(html, /Internet Archive's copy from 2026-11-17/);
  assert.doesNotMatch(render.article({ title: 'T', content: '<p>x</p>', textLength: 500 }, 'https://news.example/a'), /Internet Archive/);
});
