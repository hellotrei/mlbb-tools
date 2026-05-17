# App: Vercel API Proxy (`apps/vercel-api-proxy`)

## Responsibility

This service is a small Hono server that proxies an upstream MediaWiki/Liquipedia API endpoint and adds:

- A stricter, simplified interface (`GET /api.php?page=...` only).
- Token gating via `x-proxy-token` (optional).
- Retries for transient upstream errors (403/429/5xx) with short backoff.
- Cache headers suitable for edge caching (`s-maxage` + `stale-while-revalidate`).

It is used as an optional upstream helper for the API tournament engine (depending on how `VERCEL_API` is configured).

## Entry point

- `apps/vercel-api-proxy/src/index.ts`

## Environment variables

- `VERCEL_API_UPSTREAM_URL` (required): upstream base URL for the Liquipedia API.
- `VERCEL_API_PROXY_TOKEN` (optional): if set, requests must include the matching `x-proxy-token` header.

## Endpoints

- `GET /health` — basic health check.
- `GET /api.php?page=<wikipage>` — fetches wikitext via upstream `action=parse&format=json&prop=wikitext&page=...`.
- `GET *` — returns 404 JSON.

