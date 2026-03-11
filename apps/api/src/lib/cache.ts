import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
let disableUntil = 0;

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
  try {
    const conn = client();
    if (!conn) return null;
    const raw = await conn.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    disableTemporarily();
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 120): Promise<void> {
  try {
    const conn = client();
    if (!conn) return;
    await conn.setex(key, ttlSeconds, JSON.stringify(value));
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
