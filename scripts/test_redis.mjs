import dotenv from "dotenv";
dotenv.config();

import IORedis from "ioredis";

async function testRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("FAIL: REDIS_URL not configured");
    process.exit(1);
  }

  const isTls = redisUrl.startsWith("rediss://") || redisUrl.includes("upstash.io");
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: isTls ? {} : undefined,
    connectTimeout: 10000,
  });

  try {
    const testKey = `healthcheck:${Date.now()}`;
    const testVal = "antigravity-messenger-ok";

    await redis.set(testKey, testVal, "EX", 30);
    const retrieved = await redis.get(testKey);

    if (retrieved === testVal) {
      await redis.del(testKey);
      await redis.quit();
      console.log("OK");
    } else {
      console.error("FAIL: Retrieved value did not match");
      process.exit(1);
    }
  } catch (err) {
    console.error("FAIL:", err.message);
    try { await redis.quit(); } catch {}
    process.exit(1);
  }
}

testRedis();

