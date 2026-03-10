import { PUBLIC_API_BASE_URL } from "$env/static/public";

const base = PUBLIC_API_BASE_URL || "http://localhost:8787";

export function apiUrl(path: string) {
  return `${base}${path}`;
}
