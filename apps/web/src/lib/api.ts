import { browser } from "$app/environment";
import { PUBLIC_API_BASE_URL } from "$env/static/public";

const DEFAULT_API_PORT = "8787";

function defaultApiBase() {
  if (!browser) return `http://localhost:${DEFAULT_API_PORT}`;

  const origin = new URL(window.location.origin);
  origin.port = DEFAULT_API_PORT;
  return origin.origin;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${PUBLIC_API_BASE_URL || defaultApiBase()}${normalizedPath}`;
}
