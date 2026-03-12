import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
let disableUntil = 0;

interface L1Entry {
  raw: string;
  expiresAt: number;
}
const l1Cache = new Map<string, L1Entry>();
const L1_MAX_TTL_MS = 30_000;

function l1Get(key: string): string | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1Cache.delete(key);
    return null;
  }
  return entry.raw;
}

function l1Set(key: string, raw: string, redisTtlSeconds: number): void {
  const ttlMs = Math.min(redisTtlSeconds * 1000, L1_MAX_TTL_MS);
  l1Cache.set(key, { raw, expiresAt: Date.now() + ttlMs });
}

function isTemporarilyDisabled() {
  return disableUntil > Date.now();
}

function disableTemporarily() {
  disableUntil = Date.now() + 30_000;
}

function client() {
  if (isTemporarilyDisabled()) return null;
  if (!redis) {
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableReadyCheck: false,
      connectTimeout: 3000,
      commandTimeout: 3000,
      retryStrategy: () => null
    });
    redis.on("error", () => disableTemporarily());
  }
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const l1Raw = l1Get(key);
  if (l1Raw !== null) return JSON.parse(l1Raw) as T;
  try {
    const conn = client();
    if (!conn) return null;
    const raw = await conn.get(key);
    if (!raw) return null;
    l1Set(key, raw, 120);
    return JSON.parse(raw) as T;
  } catch {
    disableTemporarily();
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 120): Promise<void> {
  const raw = JSON.stringify(value);
  l1Set(key, raw, ttlSeconds);
  try {
    const conn = client();
    if (!conn) return;
    await conn.setex(key, ttlSeconds, raw);
  } catch {
    disableTemporarily();
  }
}

export async function cachePing(): Promise<boolean> {
  try {
    const conn = client();
    if (!conn) return false;
    const pong = await conn.ping();
    return pong === "PONG";
  } catch {
    disableTemporarily();
    return false;
  }
}

export async function closeCache(): Promise<void> {
  if (!redis) return;
  await redis.quit();
  redis = null;
}
