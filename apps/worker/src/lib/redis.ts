import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  enableReadyCheck: false,
  connectTimeout: 5000,
  commandTimeout: 5000,
  retryStrategy: () => null
});

redis.on("error", (err: Error) => {
  console.error("[redis] connection error:", err.message);
});
