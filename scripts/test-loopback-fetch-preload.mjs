/*
 * Real-network (loopback only) harness for scripts/check-auth-signup.mjs tests. The script only
 * accepts the canonical https origin of the project, so this preload sends those requests to a
 * local HTTP server (__LOOPBACK_ORIGIN) through Node's real fetch, with the script's own options
 * untouched. Redirects are then handled by Node's fetch itself, not by test code. Any request to
 * a host other than the canonical origin or 127.0.0.1 is refused, so nothing reaches the cloud.
 */
const loopback = process.env.__LOOPBACK_ORIGIN;
if (loopback) {
  const canonical = "https://zokkgocmcaqcujltfkjf.supabase.co";
  const realFetch = globalThis.fetch;

  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`${canonical}/`)) return realFetch(`${loopback}${url.slice(canonical.length)}`, init);
    if (new URL(url).hostname === "127.0.0.1") return realFetch(url, init);
    throw new Error(`loopback harness: refusing request to ${new URL(url).origin}`);
  };
}
