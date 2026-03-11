import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
let disableUntil = 0;

function isTemporarilyDisabled() {
  return disableUntil > Date.now();
}

function client() {
  if (isTemporarilyDisabled()) return null;
  if (!redis) {
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false
    });
    redis.on("error", () => disableTemporarily());
  }

  return redis;
}

function disableTemporarily() {
  disableUntil = Date.now() + 30_000;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const conn = client();
    if (!conn) return null;
    if (conn.status !== "ready") {
      await conn.connect();
    }
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
    if (conn.status !== "ready") {
      await conn.connect();
    }
    await conn.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    disableTemporarily();
  }
}

export async function cachePing(): Promise<boolean> {
  try {
    const conn = client();
    if (!conn) return false;
    if (conn.status !== "ready") {
      await conn.connect();
    }
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
