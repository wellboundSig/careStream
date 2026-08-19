/** Owner ids may include a single prefix (issue-reports/usr_x) but not traversal. */
export function sanitizeOwnerId(raw) {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/^\/+|\/+$/g, '');
}

export function sanitizeFilename(raw) {
  const name = String(raw || 'file').replace(/[/\\]/g, '_').replace(/\.\./g, '_').replace(/^\.+/, '_') || 'file';
  return name.slice(0, 180);
}

export function buildObjectKey(prefix, filename) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${Date.now()}_${rand}_${filename}`;
}
