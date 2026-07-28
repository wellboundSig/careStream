/**
 * Conservative HTML sanitizer for untrusted stored content (e.g. inbound email).
 * Strips scripts, event handlers, javascript: URLs, iframes, objects, and
 * dangerous tags. Not a full DOMPurify replacement — keep the allowlist tight.
 */
export function sanitizeBasicHtml(html) {
  let s = String(html || '');
  // Remove whole dangerous elements (including content).
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)[\s\S]*?>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)[^>]*\/?\s*>/gi, '');
  // Event-handler attributes (quoted / unquoted).
  s = s.replace(/\s+on\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  // javascript: / vbscript: / data:text/html URLs in href/src/action/formaaction.
  s = s.replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*(['"]?)\s*(javascript|vbscript|data)\s*:/gi, ' $1=$2#blocked:');
  // svg/math can host script — strip for inbound preview.
  s = s.replace(/<\s*\/?\s*(svg|math)[^>]*>/gi, '');
  return s;
}

/** Escape text for safe interpolation into HTML strings (print windows, etc.). */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
