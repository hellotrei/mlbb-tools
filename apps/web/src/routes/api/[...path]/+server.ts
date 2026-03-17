import { PUBLIC_API_BASE_URL } from "$env/static/public";
import type { RequestHandler } from "./$types";

function buildTargetUrl(url: URL, path: string) {
  const base = PUBLIC_API_BASE_URL.trim().replace(/\/+$/, "");
  const normalizedPath = path ? `/${path}` : "";
  return `${base}${normalizedPath}${url.search}`;
}

async function proxy(request: Request, paramsPath: string) {
  const apiBaseUrl = PUBLIC_API_BASE_URL.trim();
  if (!apiBaseUrl) {
    return new Response(JSON.stringify({ error: "PUBLIC_API_BASE_URL is not configured." }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const targetUrl = buildTargetUrl(new URL(request.url), paramsPath);
  const headers = new Headers({
    accept: request.headers.get("accept") ?? "application/json"
  });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  const cacheControl = upstream.headers.get("cache-control");
  if (contentType) responseHeaders.set("content-type", contentType);
  if (cacheControl) responseHeaders.set("cache-control", cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

const handler: RequestHandler = async ({ request, params }) => {
  return proxy(request, params.path);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
