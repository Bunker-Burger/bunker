import { writeFileSync } from "node:fs";

const configRaw = process.env.__MOCK_FETCH_CONFIG;
if (configRaw) {
  const config = JSON.parse(configRaw);
  const logFile = process.env.__MOCK_FETCH_LOG_FILE;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init.method ?? "GET";
    const headers = init.headers ?? {};
    let body = null;
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const reqRecord = { url, method, headers, body };
    requests.push(reqRecord);

    if (logFile) {
      try {
        writeFileSync(logFile, JSON.stringify(requests, null, 2));
      } catch {
        // Ignorar fallos de escritura en prueba
      }
    }

    const callIndex = requests.length - 1;
    const rule = config.responses?.[callIndex] ?? config.defaultResponse ?? { status: 200, body: {} };

    if (rule.networkError) {
      throw new Error(rule.networkError);
    }

    const bodyText = typeof rule.rawBody === "string" ? rule.rawBody : JSON.stringify(rule.body ?? {});
    return new Response(bodyText, {
      status: rule.status ?? 200,
      headers: { "content-type": "application/json", ...(rule.headers ?? {}) }
    });
  };
}
