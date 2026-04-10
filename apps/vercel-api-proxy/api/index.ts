import type { IncomingMessage, ServerResponse } from "node:http";

const RETRYABLE_STATUSES = new Set([403, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const VERCEL_CACHE_SECONDS = 300;
const STALE_WHILE_REVALIDATE_SECONDS = 600;

function getUpstreamBaseUrl() {
  const value = (process.env.VERCEL_API_UPSTREAM_URL ?? "").trim();
  if (!value) {
    throw new Error("VERCEL_API_UPSTREAM_URL is required");
  }
  return value;
}

function getProxyToken() {
  return (process.env.VERCEL_API_PROXY_TOKEN ?? "").trim();
}

function getHeader(req: IncomingMessage, key: string) {
  const raw = req.headers[key.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function validateToken(req: IncomingMessage) {
  const token = getProxyToken();
  if (!token) return true;
  const provided = getHeader(req, "x-proxy-token").trim();
  return provided.length > 0 && provided === token;
}

function buildUpstreamUrl(req: IncomingMessage) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const page = requestUrl.searchParams.get("page")?.trim();
  if (!page) {
    return { error: "Missing required query parameter: page" } as const;
  }

  const upstreamUrl = new URL(getUpstreamBaseUrl());
  upstreamUrl.searchParams.set("action", "parse");
  upstreamUrl.searchParams.set("format", "json");
  upstreamUrl.searchParams.set("prop", "wikitext");
  upstreamUrl.searchParams.set("page", page);

  return { url: upstreamUrl } as const;
}

function vercelApiHeaders() {
  return {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-encoding": "gzip",
    "user-agent": "DraftArenaBot/1.0 (+https://mlbbdraftarena.vercel.app)"
  };
}

function wait(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fetchUpstreamWithRetry(url: URL) {
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: vercelApiHeaders(),
        signal: controller.signal
      });

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }

      lastResponse = response;
      try {
        await response.body?.cancel();
      } catch {}

      await wait(250 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error("Upstream request failed.");
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if ((req.url ?? "").startsWith("/health")) {
    return sendJson(res, 200, { ok: true });
  }

  if ((req.url ?? "").startsWith("/api.php") === false) {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (!validateToken(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const built = buildUpstreamUrl(req);
  if ("error" in built) {
    return sendJson(res, 400, { error: built.error });
  }

  const startedAt = Date.now();
  const upstreamUrl = built.url;

  try {
    const upstreamResponse = await fetchUpstreamWithRetry(upstreamUrl);
    const textBody = await upstreamResponse.text();

    res.statusCode = upstreamResponse.status;
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${VERCEL_CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`
    );
    res.setHeader("Vary", "x-proxy-token");
    res.setHeader("X-Upstream-Status", String(upstreamResponse.status));
    res.setHeader("X-Proxy-Latency-Ms", String(Date.now() - startedAt));
    res.setHeader("content-type", upstreamResponse.headers.get("content-type") ?? "application/json");
    res.end(textBody);
  } catch (error) {
    console.warn("[vercel-api-proxy] upstream request failed", {
      message: error instanceof Error ? error.message : String(error),
      page: upstreamUrl.searchParams.get("page") ?? ""
    });
    return sendJson(res, 503, { error: "Upstream unavailable" });
  }
}
