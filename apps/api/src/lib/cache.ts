import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis | null = null;
let disabled = false;

function client() {
  if (disabled) return null;
  if (!redis) {
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false
    });
  }

  return redis;
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
    disabled = true;
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
    disabled = true;
  }
}
