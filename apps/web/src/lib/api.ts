import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

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
  if ((env.PUBLIC_API_PROXY_ENABLED ?? "") === "true") {
    return `${SAME_ORIGIN_API_PREFIX}${normalizedPath}`;
  }
  return `${env.PUBLIC_API_BASE_URL || defaultApiBase()}${normalizedPath}`;
}
