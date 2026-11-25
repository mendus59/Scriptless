'use strict';
// Pure URL and address checks shared by the Node server and the Cloudflare Worker.

const ipaddr = require('ipaddr.js');
const { cleanUrl } = require('./clean-url');

const ALLOWED_PORTS = new Set(['', '80', '443']);

class FetchError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** True only for globally routable unicast addresses. */
function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  let addr = ipaddr.parse(address);
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
  const range = addr.range();
  if (range !== 'unicast') return false;
  if (addr.kind() === 'ipv6') {
    // NAT64 / 6to4 / Teredo can smuggle internal IPv4 targets.
    const s = addr.toNormalizedString();
    if (s.startsWith('64:ff9b:') || s.startsWith('2002:') || s.startsWith('2001:0:')) return false;
  }
  return true;
}

function validateTarget(input, opts = { allowedPorts: ALLOWED_PORTS, allowPrivate: false }) {
  let u;
  try {
    u = cleanUrl(input);
  } catch {
    throw new FetchError('That does not look like a valid web address.', 400);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchError('Only http and https addresses are supported.', 400);
  }
  if (!opts.allowedPorts.has(u.port)) {
    throw new FetchError('Only the standard web ports (80 and 443) are allowed.', 400);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    if (!opts.allowPrivate) throw new FetchError('That address is not allowed.', 400);
  }
  if (ipaddr.isValid(host) && !opts.allowPrivate && !isPublicAddress(host)) {
    throw new FetchError('That address is not allowed.', 400);
  }
  return u;
}

module.exports = { FetchError, isPublicAddress, validateTarget, ALLOWED_PORTS };
