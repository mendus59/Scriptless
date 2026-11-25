'use strict';
// Response headers for every page Scriptless serves (Node server and Worker).

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'", "style-src 'self'", "img-src 'none'", "font-src 'none'", "script-src 'none'",
    "connect-src 'none'", "frame-src 'none'", "media-src 'none'", "object-src 'none'", "manifest-src 'none'",
    "worker-src 'none'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'", 'sandbox allow-forms allow-same-origin allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox',
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};

module.exports = { SECURITY_HEADERS };
