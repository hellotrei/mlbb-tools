const base = import.meta.env.PUBLIC_API_BASE_URL || "http://localhost:8787";

export function apiUrl(path: string) {
  return `${base}${path}`;
}
