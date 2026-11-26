'use strict';
// Recognises pages that are not the article at all: bot checks that answer with a
// normal 200 (Bloomberg, PerimeterX, DataDome, Cloudflare challenges), and articles
// the publisher marks as subscriber-only. Plain string checks, no DOM needed.

// Bot-check pages, by the address they send readers to or by a marker in the page.
const WALL_URLS = [
  /\/tosv2\.html/i, // Bloomberg's "Are you a robot?"
  /\/cdn-cgi\/challenge-platform\//i,
  /[?&]__cf_chl_/i,
];
const WALL_MARKERS = [
  /px-captcha/i, // PerimeterX / HUMAN
  /captcha-delivery\.com/i, // DataDome
  /_cf_chl_opt|challenges\.cloudflare\.com/i,
  /geo\.captcha-delivery|perimeterx\.net/i,
];
const WALL_TITLES = /^\s*(are you a robot\??|just a moment\.*|attention required!?.*|verify you are (a )?human.*|pardon our interruption.*|access to this page has been denied.*|please verify you are a human.*)\s*$/i;

/** Returns a short description of the bot check, or null when this looks like a real page. */
function botWall(url, html) {
  if (WALL_URLS.some((r) => r.test(url || ''))) return 'robot check';
  const s = String(html || '');
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1];
  if (title && WALL_TITLES.test(title.replace(/\s+/g, ' '))) return 'robot check';
  // Markers alone could appear in a real article about bots, so only trust them on short pages.
  if (s.length < 60_000 && WALL_MARKERS.some((r) => r.test(s))) return 'robot check';
  return null;
}

/** Every JSON-LD object on the page, flattened out of arrays and @graph. */
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      out.push(v);
      if (v['@graph']) walk(v['@graph']);
    }
  };
  while ((m = re.exec(String(html || '')))) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // Broken JSON-LD is common; ignore it.
    }
  }
  return out;
}

const free = (v) => !(v === false || /^false$/i.test(String(v ?? '').trim()));

/** True when the publisher marks the article as not free to read (schema.org isAccessibleForFree). */
function isPaywalled(html) {
  return jsonLd(html).some((o) => {
    if ('isAccessibleForFree' in o && !free(o.isAccessibleForFree)) return true;
    const parts = [].concat(o.hasPart || []);
    return parts.some((p) => p && typeof p === 'object' && 'isAccessibleForFree' in p && !free(p.isAccessibleForFree));
  });
}

module.exports = { botWall, isPaywalled, jsonLd };
