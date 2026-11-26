'use strict';
// Fallback for sites that refuse to talk to Scriptless's servers (common with large
// publishers that block data-center or Cloudflare addresses). When the site says no,
// read the Internet Archive's most recent copy instead. The Archive sees the address
// being read, but, like the original site, never the reader.

const { FetchError } = require('./target');
const { cleanUrl } = require('./clean-url');
const { botWall } = require('./walls');

// Responses that mean "not you" rather than "no such page".
const BLOCKED = new Set([401, 403, 429, 451, 503]);
// The Archive is often slow; give it longer than a normal site.
const ARCHIVE_TIMEOUT_MS = 25_000;

function stamp(now = new Date()) {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

function archiveUrl(url, ts = stamp()) {
  // id_ asks for the page exactly as captured, without the Archive's toolbar.
  return `https://web.archive.org/web/${ts}id_/${url}`;
}

function lookupUrl(url) {
  return `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
}

function snapshotDate(finalUrl) {
  const m = /web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})/.exec(finalUrl);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function reason(e) {
  if (e instanceof FetchError) return e.upstreamStatus ? `error ${e.upstreamStatus}` : e.message.replace(/\.$/, '').toLowerCase();
  return 'unreachable';
}

/**
 * fetchPage(url, { json, timeoutMs }) -> { url, html }.
 * Returns { url, html, archived } where archived is the snapshot date (YYYY-MM-DD)
 * when the Archive copy was used, otherwise null.
 */
async function fetchWithFallback(fetchPage, input, now = new Date()) {
  let why;
  try {
    const r = await fetchPage(input);
    // Some sites (Bloomberg, for one) answer "200 OK" with a robot check instead of the article.
    if (!botWall(r.url, r.html)) return { ...r, archived: null };
    why = 'answered Scriptless with a robot check instead of the article';
  } catch (e) {
    if (!(e instanceof FetchError) || !BLOCKED.has(e.upstreamStatus)) throw e;
    why = `refused to let Scriptless read this page (error ${e.upstreamStatus})`;
  }
  const original = cleanUrl(input).href;
  const host = new URL(original).hostname.replace(/^www\./, '');
  const refused = `${host} ${why}`;

  // 1. Ask the Archive which snapshot is newest. If the lookup itself fails,
  //    fall through and ask for the snapshot closest to now directly.
  let ts = null;
  let lookedUp = false;
  try {
    const r = await fetchPage(lookupUrl(original), { json: true, timeoutMs: ARCHIVE_TIMEOUT_MS });
    const closest = JSON.parse(r.html)?.archived_snapshots?.closest;
    lookedUp = true;
    if (closest && closest.available && /^\d{14}$/.test(closest.timestamp)) ts = closest.timestamp;
  } catch {
    lookedUp = false;
  }
  if (lookedUp && !ts) {
    throw new FetchError(`${refused}, and the Internet Archive has no copy of it yet. Some publishers block reader services like this one.`, 502);
  }

  // 2. Read that snapshot (or the one closest to now, if the lookup failed).
  let r;
  try {
    r = await fetchPage(archiveUrl(original, ts || stamp(now)), { timeoutMs: ARCHIVE_TIMEOUT_MS });
  } catch (archiveErr) {
    throw new FetchError(
      `${refused}, and the Internet Archive copy could not be loaded either (${reason(archiveErr)}). Some publishers block reader services like this one.`,
      502,
    );
  }
  // The Archive's crawler gets the same robot check sometimes; that copy is no use either.
  if (botWall(r.url, r.html)) {
    throw new FetchError(`${refused}, and the Internet Archive only saved that same robot check. Some publishers block reader services like this one.`, 502);
  }
  return { url: original, html: r.html, archived: snapshotDate(r.url) || 'an unknown date' };
}

module.exports = { fetchWithFallback, archiveUrl, lookupUrl, snapshotDate, BLOCKED };
