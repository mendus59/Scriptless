'use strict';
// Turns raw HTML into a small, inert article: text, headings, lists, quotes,
// code, tables and links. Nothing that can load or run anything survives.

const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const sanitizeHtml = require('sanitize-html');
const { cleanUrl } = require('./clean-url');
const { isPaywalled, jsonLd } = require('./walls');

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
  'mark', 'small', 'sub', 'sup', 'abbr', 'q', 'cite', 'kbd', 'samp', 'var', 'time',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'a', 'span', 'div', 'section', 'article', 'aside', 'details', 'summary',
];

function readerLink(href, base) {
  try {
    const abs = new URL(href, base);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    return '/read?url=' + encodeURIComponent(cleanUrl(abs.href).href);
  } catch {
    return null;
  }
}

function sanitize(html, baseUrl) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], abbr: ['title'], time: ['datetime'] },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'canvas', 'video', 'audio', 'form'],
    exclusiveFilter: (frame) => ['div', 'span', 'p', 'section'].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length,
    transformTags: {
      // Images are external resources. Keep their description, never the image.
      img: (tagName, attribs) => ({
        tagName: 'span',
        attribs: { class: 'img-alt' },
        text: attribs.alt && attribs.alt.trim() ? `[Image: ${attribs.alt.trim()}]` : '',
      }),
      a: (tagName, attribs) => {
        const href = attribs.href && !attribs.href.startsWith('#') ? readerLink(attribs.href, baseUrl) : null;
        return href ? { tagName: 'a', attribs: { href } } : { tagName: 'span', attribs: {} };
      },
    },
    allowedClasses: { span: ['img-alt'] },
  });
}

function textOnly(s) {
  return sanitizeHtml(String(s || ''), { allowedTags: [], allowedAttributes: {} }).trim();
}

/** Returns { title, byline, siteName, published, content, textLength } */
function extract(html, url) {
  // linkedom is a plain DOM parser: it never runs scripts or loads anything.
  const doc = parseHTML(html).document;
  const fallbackTitle = doc.title;

  let article = null;
  try {
    article = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
  } catch {
    article = null;
  }

  let content;
  if (article && article.content && article.textContent.trim().length > 0) {
    content = sanitize(article.content, url);
  } else {
    // Fallback: plain paragraphs of the visible body text.
    const fresh = parseHTML(html).document;
    fresh.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form').forEach((n) => n.remove());
    const paras = (fresh.body ? fresh.body.textContent : '')
      .split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0);
    content = sanitize(paras.map((p) => `<p>${sanitizeHtml(p, { allowedTags: [] })}</p>`).join('\n'), url);
  }

  // Pages that build their text with JavaScript often still ship the full article as
  // schema.org articleBody for search engines. Use it when it is clearly more complete,
  // but never for articles the publisher marks as subscriber-only.
  const paywalled = isPaywalled(html);
  if (!paywalled) {
    const body = jsonLd(html).map((o) => (typeof o.articleBody === 'string' ? o.articleBody : '')).sort((x, y) => y.length - x.length)[0] || '';
    const have = textOnly(content).length;
    if (body.length > 500 && body.length > have * 1.5) {
      const paras = textOnly(body).split(/\n\s*\n+|\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      content = sanitize(paras.map((p) => `<p>${sanitizeHtml(p, { allowedTags: [] })}</p>`).join('\n'), url);
    }
  }

  return {
    paywalled,
    title: textOnly(article?.title || fallbackTitle) || 'Untitled page',
    byline: textOnly(article?.byline),
    siteName: textOnly(article?.siteName),
    published: textOnly(article?.publishedTime),
    excerpt: textOnly(article?.excerpt),
    content,
    textLength: textOnly(content).length,
  };
}

module.exports = { extract, sanitize };
