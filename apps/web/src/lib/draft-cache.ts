type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

function storageKey(key: string) {
  return `draft-cache:${key}`;
}

export function getDraftCache<T>(key: string): T | null {
  const now = Date.now();
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > now) {
      return memoryEntry.value as T;
    }
    memoryCache.delete(key);
  }

  if (typeof sessionStorage === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(storageKey(key));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }

    memoryCache.set(key, parsed);
    return parsed.value;
  } catch {
    sessionStorage.removeItem(storageKey(key));
    return null;
  }
}

export function setDraftCache<T>(key: string, value: T, ttlMs: number) {
  const entry: CacheEntry<T> = {
    expiresAt: Date.now() + ttlMs,
    value
  };

  memoryCache.set(key, entry);
  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Ignore quota/storage errors and keep memory cache only.
  }
}
