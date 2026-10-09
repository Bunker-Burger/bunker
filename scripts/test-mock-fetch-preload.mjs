import { writeFileSync } from "node:fs";

/*
 * Replaces fetch for scripts/check-auth-signup.mjs tests (no network). Each request is answered by
 * the next rule in __MOCK_FETCH_CONFIG and logged, with the options the script passed, to
 * __MOCK_FETCH_LOG_FILE.
 *
 * A rule with `redirectTo` answers with a redirect and handles it the way fetch does, according to
 * the script's own `redirect` option:
 * - "error": rejects with TypeError, like Node's fetch ("unexpected redirect");
 * - "manual": returns the 3xx response untouched;
 * - "follow" (fetch's default when the option is missing): sends a second request to `redirectTo`
 *   (POST becomes GET on 301/302/303; 307/308 resend method, headers and body), logs it, and
 *   answers it with `followed`, marking the response as redirected.
 */
const configRaw = process.env.__MOCK_FETCH_CONFIG;
if (configRaw) {
  const config = JSON.parse(configRaw);
  const logFile = process.env.__MOCK_FETCH_LOG_FILE;
  const requests = [];

  const parseBody = (raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const record = (entry) => {
    requests.push(entry);
    if (logFile) {
      try {
        writeFileSync(logFile, JSON.stringify(requests, null, 2));
      } catch {
        // Ignorar fallos de escritura en prueba
      }
    }
  };

  const respond = (rule, extraHeaders = {}) => {
    const bodyText = typeof rule.rawBody === "string" ? rule.rawBody : JSON.stringify(rule.body ?? {});
    return new Response(bodyText, {
      status: rule.status ?? 200,
      headers: { "content-type": "application/json", ...(rule.headers ?? {}), ...extraHeaders }
    });
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init.method ?? "GET";
    const headers = init.headers ?? {};
    // `redirect` is logged exactly as passed (null when missing), so tests can check the option.
    record({ url, method, headers, body: parseBody(init.body), redirect: init.redirect ?? null });

    const rule = config.responses?.[requests.length - 1] ?? config.defaultResponse ?? { status: 200, body: {} };

    if (rule.networkError) {
      throw new Error(rule.networkError);
    }

    if (rule.redirectTo) {
      const mode = init.redirect ?? "follow";
      if (mode === "error") {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      }
      if (mode === "manual") {
        return respond({ ...rule, body: {} }, { location: rule.redirectTo });
      }
      const keepsMethod = rule.status === 307 || rule.status === 308;
      record({
        url: rule.redirectTo,
        method: keepsMethod ? method : "GET",
        headers,
        body: keepsMethod ? parseBody(init.body) : null,
        redirect: init.redirect ?? null
      });
      const followed = respond(rule.followed ?? { status: 200, body: {} });
      Object.defineProperty(followed, "redirected", { value: true });
      Object.defineProperty(followed, "url", { value: rule.redirectTo });
      return followed;
    }

    return respond(rule);
  };
}
