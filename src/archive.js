'use strict';
// Fallback for sites that refuse to talk to Scriptless's servers (common with large
// publishers that block data-center or Cloudflare addresses). When the site says no,
// read the Internet Archive's most recent copy instead. The Archive sees the address
// being read, but, like the original site, never the reader.

const { FetchError } = require('./target');
const { cleanUrl } = require('./clean-url');

// Responses that mean "not you" rather than "no such page".
const BLOCKED = new Set([401, 403, 429, 451, 503]);

function archiveUrl(url, now = new Date()) {
  const ts = now.toISOString().replace(/\D/g, '').slice(0, 14);
  // id_ asks for the page exactly as captured, without the Archive's toolbar.
  return `https://web.archive.org/web/${ts}id_/${url}`;
}

function snapshotDate(finalUrl) {
  const m = /web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})/.exec(finalUrl);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * fetchPage(url) -> { url, html }. Returns { url, html, archived } where archived is the
 * snapshot date (YYYY-MM-DD) when the Archive copy was used, otherwise null.
 */
async function fetchWithFallback(fetchPage, input, now) {
  try {
    const r = await fetchPage(input);
    return { ...r, archived: null };
  } catch (e) {
    if (!(e instanceof FetchError) || !BLOCKED.has(e.upstreamStatus)) throw e;
    const original = cleanUrl(input).href;
    const host = new URL(original).hostname.replace(/^www\./, '');
    try {
      const r = await fetchPage(archiveUrl(original, now));
      return { url: original, html: r.html, archived: snapshotDate(r.url) || 'an unknown date' };
    } catch {
      throw new FetchError(
        `${host} refused to let Scriptless read this page (error ${e.upstreamStatus}), and the Internet Archive has no copy of it. ` +
        'Some publishers block reader services like this one.',
        502,
      );
    }
  }
}

module.exports = { fetchWithFallback, archiveUrl, snapshotDate, BLOCKED };
