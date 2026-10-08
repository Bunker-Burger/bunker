/** Where `/bunker` sends a signed-in admin when no (valid) destination was requested. */
export const ADMIN_HOME = "/bunker/admin";
/** Login page. */
export const ADMIN_LOGIN = "/bunker";

const SENTINEL_ORIGIN = "https://bunker.invalid";

/**
 * Post-login destination from an untrusted `next` value: only a same-origin path inside
 * `/bunker/admin` is honoured; anything else (absolute or protocol-relative URLs, backslashes,
 * encoded tricks, other sections) falls back to the admin home. Never an open redirect.
 */
export function safeAdminPath(next: unknown): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return ADMIN_HOME;
  // Only plain absolute paths: no scheme, no "//host", no backslashes or control characters.
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return ADMIN_HOME;
  let url: URL;
  try {
    url = new URL(next, SENTINEL_ORIGIN);
  } catch {
    return ADMIN_HOME;
  }
  if (url.origin !== SENTINEL_ORIGIN) return ADMIN_HOME;
  if (url.pathname !== ADMIN_HOME && !url.pathname.startsWith(`${ADMIN_HOME}/`)) return ADMIN_HOME;
  return `${url.pathname}${url.search}`;
}

/** Login URL that returns to `path` (already a trusted admin path) after signing in. */
export function loginPathFor(path: string): string {
  const destination = safeAdminPath(path);
  return destination === ADMIN_HOME ? ADMIN_LOGIN : `${ADMIN_LOGIN}?next=${encodeURIComponent(destination)}`;
}
