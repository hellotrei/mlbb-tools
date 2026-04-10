import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

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

function validateToken(request: Request) {
  const token = getProxyToken();
  if (!token) return true;
  const provided = request.headers.get("x-proxy-token")?.trim() ?? "";
  return provided.length > 0 && provided === token;
}

function buildUpstreamUrl(requestUrl: URL) {
  const upstreamUrl = new URL(getUpstreamBaseUrl());
  const page = requestUrl.searchParams.get("page")?.trim();
  if (!page) {
    return { error: "Missing required query parameter: page" } as const;
  }

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

      const backoffMs = 250 * attempt;
      await wait(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error("Upstream request failed.");
}

app.get("/health", (c) => c.json({ ok: true }, 200));

app.get("/api.php", async (c) => {
  if (!validateToken(c.req.raw)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const built = buildUpstreamUrl(new URL(c.req.url));
  if ("error" in built) {
    return c.json({ error: built.error }, 400);
  }

  const startedAt = Date.now();
  const upstreamUrl = built.url;

  try {
    const upstreamResponse = await fetchUpstreamWithRetry(upstreamUrl);
    const textBody = await upstreamResponse.text();

    c.header("Cache-Control", `public, s-maxage=${VERCEL_CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`);
    c.header("Vary", "x-proxy-token");
    c.header("X-Upstream-Status", String(upstreamResponse.status));
    c.header("X-Proxy-Latency-Ms", String(Date.now() - startedAt));

    if (!upstreamResponse.ok) {
      console.warn("[vercel-api-proxy] upstream non-200", {
        status: upstreamResponse.status,
        page: upstreamUrl.searchParams.get("page") ?? ""
      });

      return c.body(textBody, upstreamResponse.status, {
        "content-type": upstreamResponse.headers.get("content-type") ?? "application/json"
      });
    }

    return c.body(textBody, 200, {
      "content-type": upstreamResponse.headers.get("content-type") ?? "application/json"
    });
  } catch (error) {
    console.warn("[vercel-api-proxy] upstream request failed", {
      message: error instanceof Error ? error.message : String(error),
      page: upstreamUrl.searchParams.get("page") ?? ""
    });

    return c.json({ error: "Upstream unavailable" }, 503);
  }
});

app.get("*", (c) => c.json({ error: "Not found" }, 404));

export default app;

if (process.env.VERCEL !== "1") {
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8788);
  serve({
    fetch: app.fetch,
    port
  });
}
