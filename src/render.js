'use strict';
// Server-rendered HTML. The pages contain no JavaScript at all.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Where links and forms point. The Node server and Worker use the defaults; the static
// GitHub Pages build (scripts/build-site.js) points forms at the Worker instead.
const DEFAULT_LINKS = { home: '/', about: '/about', css: '/style.css', read: '/read', cspMeta: '' };

function layout(title, body, { topForm = true, links = DEFAULT_LINKS } = {}) {
  const L = { ...DEFAULT_LINKS, ...links };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">${L.cspMeta}
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(L.css)}">
</head>
<body>
<header class="bar">
  <a class="brand" href="${esc(L.home)}">Scriptless</a>
  ${topForm ? `<form class="mini" method="post" action="${esc(L.read)}">
    <label class="sr" for="u-top">Address to read</label>
    <input id="u-top" name="url" type="text" inputmode="url" placeholder="Paste a link" required autocomplete="off" spellcheck="false">
    <button type="submit">Read</button>
  </form>` : ''}
</header>
<main>
${body}
</main>
<footer class="foot">No scripts, no cookies, no logs. <a href="${esc(L.about)}">How it works</a></footer>
</body>
</html>`;
}

function home(links) {
  return layout('Scriptless', `
<section class="hero">
  <h1>Read the web, quietly.</h1>
  <p>Paste a link. Scriptless fetches the page from its own server and gives you just the words. The site never sees you, and nothing it ships (scripts, ads, trackers, cookies, images, fonts) reaches your browser.</p>
  <form class="big" method="post" action="${esc({ ...DEFAULT_LINKS, ...links }.read)}">
    <label class="sr" for="u">Address to read</label>
    <input id="u" name="url" type="text" inputmode="url" placeholder="https://example.com/some-article" required autocomplete="off" spellcheck="false">
    <button type="submit">Read it</button>
  </form>
</section>`, { topForm: false, links });
}

function about(links) {
  return layout('How Scriptless works', `
<article class="prose">
<h1>How Scriptless works</h1>
<h2>What the site you are reading sees</h2>
<p>Only this server. The request comes from the Scriptless server with a generic browser user agent, no cookies, no referrer, and none of your headers. Your IP address is never forwarded.</p>
<h2>What your browser receives</h2>
<p>A plain page of text made on the server. It contains no JavaScript, and a strict Content Security Policy forbids scripts, frames, images, fonts and connections to any other site, so even a mistake in the extractor cannot load anything.</p>
<h2>What is kept</h2>
<p>Nothing. There are no accounts, no cookies, no analytics and no access logs. Pages are not cached. Tracking parameters such as <code>utm_source</code>, <code>fbclid</code> and <code>gclid</code> are removed from every link before it is fetched or shown.</p>
<h2>When a site refuses</h2>
<p>Some publishers block requests from servers like this one. When that happens, Scriptless reads the Internet Archive's most recent copy of the page instead and tells you so. The Archive sees which page was requested, but not who asked.</p>
<h2>Links inside articles</h2>
<p>Links are rewritten to open through Scriptless too, so following them stays private. Images are replaced by their description.</p>
<h2>Limits</h2>
<p>Pages that build their text with JavaScript, or sit behind a login or paywall, may come back empty. Only public web addresses on the standard ports can be read.</p>
</article>`, { links });
}

function article(a, url, { archived = null } = {}) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const meta = [a.byline, a.siteName && a.siteName !== host ? a.siteName : '', a.published ? a.published.slice(0, 10) : '']
    .filter(Boolean).map(esc).join(' · ');
  const minutes = Math.max(1, Math.round(a.textLength / 1200));
  const empty = a.textLength < 40
    ? '<p class="note">Very little text was found. This page may build its content with JavaScript, or sit behind a login.</p>' : '';
  const archivedNote = archived
    ? `<p class="note">${esc(host)} would not let Scriptless read this page, so this is the Internet Archive's copy from ${esc(archived)}. It may be out of date.</p>` : '';
  return layout(a.title + ' · Scriptless', `
<article class="prose">
  <p class="source">${esc(host)} · ${minutes} min read</p>
  <h1>${esc(a.title)}</h1>
  ${meta ? `<p class="meta">${meta}</p>` : ''}
  ${archivedNote}
  ${empty}
  <div class="content">${a.content}</div>
  <p class="orig">Original: <a href="${esc(url)}" rel="noreferrer noopener" referrerpolicy="no-referrer">${esc(url)}</a> <span class="warn">(opens the real site, which can see you)</span></p>
</article>`);
}

function error(message) {
  return layout('Could not read that page · Scriptless', `
<section class="prose">
  <h1>Could not read that page</h1>
  <p>${esc(message)}</p>
  <p><a href="/">Try another link</a></p>
</section>`);
}

module.exports = { home, about, article, error, esc };
