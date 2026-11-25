'use strict';
// Removes common tracking parameters from a URL before it is fetched or shown.

const EXACT = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid',
  '_ga', '_gl', '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp', 'hsctatracking',
  'mkt_tok', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'rb_clickid',
  's_cid', 'sc_cid', 'icid', 'ncid', 'cmpid', 'campaign_id', 'ref_src', 'ref_url',
  'spm', 'scm', 'si', 'feature', 'trk', 'trkCampaign', 'mbid', 'srsltid',
  'wickedid', 'cvid', 'ocid', 'guccounter', 'guce_referrer', 'guce_referrer_sig',
  '_openstat', 'xtor', 'at_medium', 'at_campaign', 'ito', 'smid', 'cmp',
]);
const PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', 'oly_', 'vero_', 'at_', 'ga_', 'stm_'];

function isTracking(name) {
  const n = name.toLowerCase();
  if (EXACT.has(name) || EXACT.has(n)) return true;
  return PREFIXES.some((p) => n.startsWith(p));
}

/** Returns a new URL with tracking params and the fragment's tracking junk removed. */
function cleanUrl(input) {
  const u = new URL(input);
  for (const key of [...u.searchParams.keys()]) {
    if (isTracking(key)) u.searchParams.delete(key);
  }
  // Fragments are never sent to servers, but some carry tracking tokens (e.g. #:~:text is fine, #xtor= is not).
  if (/^#?(xtor|utm_|at_)/i.test(u.hash)) u.hash = '';
  u.username = '';
  u.password = '';
  return u;
}

module.exports = { cleanUrl, isTracking };
