# App: Web (`apps/web`)

## Responsibility

The web app is a SvelteKit frontend that:

- Renders hero stats, tiers, and Draft Master UI.
- Provides tournament UI (event creation, standings/bracket views, tutorial).
- Talks to the API either directly (cross-origin) or via an optional same-origin proxy route.

## Entry points

- SvelteKit routes: `apps/web/src/routes`
- Initial meta fetch: `apps/web/src/routes/+layout.ts` (preloads `/heroes`)

## API integration

Client-side URL builder:

- `apps/web/src/lib/api.ts`
  - Uses `PUBLIC_API_BASE_URL` by default (falls back to `http://localhost:8787` in the browser).
  - If `PUBLIC_API_PROXY_ENABLED=true`, it targets the local proxy prefix `/api/...`.

Optional same-origin proxy:

- `apps/web/src/routes/api/[...path]/+server.ts`
  - Proxies all HTTP methods to `PUBLIC_API_BASE_URL`.
  - Forwards selective headers (auth, Telegram secret header, forwarded-for, etc.).
  - Special-cases `*.sslip.io` HTTPS endpoints to allow a fallback that disables TLS verification (dev convenience).

## Dependencies

- UI/runtime: SvelteKit
- Shared UI: `@mlbb/ui` (reusable components)
- API contract: indirectly aligned with `@mlbb/shared` (API validates requests with these shared schemas)

