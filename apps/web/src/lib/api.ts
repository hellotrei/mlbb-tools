import { PUBLIC_API_BASE_URL, PUBLIC_API_PROXY_ENABLED } from "$env/static/public";

const DEFAULT_API_PORT = "8787";
const SAME_ORIGIN_API_PREFIX = "/api";

function defaultApiBase() {
  if (!browser) return `http://localhost:${DEFAULT_API_PORT}`;

  const origin = new URL(window.location.origin);
  origin.port = DEFAULT_API_PORT;
  return origin.origin;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (PUBLIC_API_PROXY_ENABLED === "true") {
    return `${SAME_ORIGIN_API_PREFIX}${normalizedPath}`;
  }
  return `${PUBLIC_API_BASE_URL || defaultApiBase()}${normalizedPath}`;
}
