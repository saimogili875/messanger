// tests/auth.test.ts
// Comprehensive integration test suite for authentication, hybrid sessions, rate limiting, and security headers.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { devices, sessions, users } from "../src/db/schema";
import { eq } from "drizzle-orm";

describe("Authentication & Session Integration Tests", () => {
  let app: FastifyInstance;
  let ipIndex = 1;

  function getIp(): string {
    return `198.51.100.${ipIndex++}`;
  }

  beforeAll(async () => {
    // Truncate all tables in messenger_test before running tests
    await client`TRUNCATE TABLE users, devices, chats, chat_members, messages, sessions CASCADE`;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const testUser = {
    email: "alice@example.com",
    password: "Password123!",
    displayName: "Alice",
  };

  it("1. Register: success (201), duplicate rejection (409), invalid input (400)", async () => {
    const ip = getIp();

    // Valid registration
    const resValid = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: ip,
      payload: testUser,
    });
    expect(resValid.statusCode).toBe(201);
    const bodyValid = JSON.parse(resValid.payload);
    expect(bodyValid.id).toBeDefined();
    expect(bodyValid.email).toBe(testUser.email.toLowerCase());
    expect(bodyValid.displayName).toBe(testUser.displayName);
    expect(bodyValid.passwordHash).toBeUndefined();
    expect(bodyValid.password_hash).toBeUndefined();

    // Duplicate registration -> 409
    const resDup = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: ip,
      payload: testUser,
    });
    expect(resDup.statusCode).toBe(409);
    expect(JSON.parse(resDup.payload).error).toBe("Email already registered");

    // Invalid input: short password (< 8 chars) -> 400
    const resBad = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: ip,
      payload: {
        email: "bad@example.com",
        password: "short",
        displayName: "Bad",
      },
    });
    expect(resBad.statusCode).toBe(400);
    const badBody = JSON.parse(resBad.payload);
    expect(badBody.error).toBe("Validation error");
    expect(badBody.details).toBeDefined();
  });

  it("2. Login: wrong credentials (401), success (200 with tokens and deviceId)", async () => {
    const ip = getIp();

    // Wrong password -> 401
    const resWrongPass = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: "WrongPassword999!",
      },
    });
    expect(resWrongPass.statusCode).toBe(401);
    expect(JSON.parse(resWrongPass.payload).error).toBe("Invalid credentials");

    // Unknown email -> 401 (uses real dummy hash)
    const resUnknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: "nonexistent@example.com",
        password: "Password123!",
      },
    });
    expect(resUnknown.statusCode).toBe(401);
    expect(JSON.parse(resUnknown.payload).error).toBe("Invalid credentials");

    // Success login with explicit deviceName
    const resSuccess = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
        deviceName: "MacBook Pro M3",
      },
    });
    expect(resSuccess.statusCode).toBe(200);
    const bodySuccess = JSON.parse(resSuccess.payload);
    expect(bodySuccess.accessToken).toBeDefined();
    expect(bodySuccess.refreshToken).toBeDefined();
    expect(bodySuccess.deviceId).toBeDefined();
    expect(bodySuccess.expiresIn).toBe(900);
  });

  it("3. GET /me: no token (401), valid access token (200)", async () => {
    const ip = getIp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken } = JSON.parse(loginRes.payload);

    // Without token -> 401
    const resNoToken = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
    });
    expect(resNoToken.statusCode).toBe(401);

    // With valid token -> 200
    const resWithToken = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    expect(resWithToken.statusCode).toBe(200);
    const meBody = JSON.parse(resWithToken.payload);
    expect(meBody.email).toBe(testUser.email.toLowerCase());
    expect(meBody.displayName).toBe(testUser.displayName);
    expect(meBody.passwordHash).toBeUndefined();
  });

  it("4. Refresh: new pair works (200), old refresh token fails (401)", async () => {
    const ip = getIp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { refreshToken: oldRefreshToken } = JSON.parse(loginRes.payload);

    // First refresh -> 200
    const refreshRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      remoteAddress: ip,
      payload: { refreshToken: oldRefreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
      JSON.parse(refreshRes.payload);
    expect(newAccessToken).toBeDefined();
    expect(newRefreshToken).toBeDefined();
    expect(newRefreshToken).not.toBe(oldRefreshToken);

    // New access token works on /me
    const meRes = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: { authorization: `Bearer ${newAccessToken}` },
    });
    expect(meRes.statusCode).toBe(200);

    // Replay of old refresh token -> 401
    const replayRes = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      remoteAddress: ip,
      payload: { refreshToken: oldRefreshToken },
    });
    expect(replayRes.statusCode).toBe(401);
  });

  it("5. Concurrent refresh: two requests at once with the same token result in exactly one 200 and one 401", async () => {
    const ip = getIp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { refreshToken } = JSON.parse(loginRes.payload);

    // Fire two refreshes simultaneously with Promise.all
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/refresh",
        remoteAddress: ip,
        payload: { refreshToken },
      }),
      app.inject({
        method: "POST",
        url: "/auth/refresh",
        remoteAddress: ip,
        payload: { refreshToken },
      }),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    expect(statusCodes).toEqual([200, 401]);
  });

  it("6. Logout: access token is immediately rejected on /me (proves session revocation check)", async () => {
    const ip = getIp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken, refreshToken } = JSON.parse(loginRes.payload);

    // Confirm access token works before logout
    const meBefore = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meBefore.statusCode).toBe(200);

    // Logout -> 204
    const logoutRes = await app.inject({
      method: "POST",
      url: "/auth/logout",
      remoteAddress: ip,
      payload: { refreshToken },
    });
    expect(logoutRes.statusCode).toBe(204);

    // Access token now rejected immediately because session was revoked
    const meAfter = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meAfter.statusCode).toBe(401);
    expect(JSON.parse(meAfter.payload).error).toBe("Unauthorized");
  });

  it("7. Two logins create two distinct sessions: logging out one does not invalidate the other", async () => {
    const ip = getIp();

    // Session A
    const loginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
        deviceName: "Device A",
      },
    });
    expect(loginA.statusCode).toBe(200);
    const { accessToken: tokenA, refreshToken: refreshA } = JSON.parse(loginA.payload);

    // Session B
    const loginB = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
        deviceName: "Device B",
      },
    });
    expect(loginB.statusCode).toBe(200);
    const { accessToken: tokenB } = JSON.parse(loginB.payload);

    // Log out Session A
    const logoutA = await app.inject({
      method: "POST",
      url: "/auth/logout",
      remoteAddress: ip,
      payload: { refreshToken: refreshA },
    });
    expect(logoutA.statusCode).toBe(204);

    // Session A access token is revoked -> 401
    const meA = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(meA.statusCode).toBe(401);

    // Session B access token is still active -> 200
    const meB = await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: ip,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(meB.statusCode).toBe(200);
  });

  it("8. Device row exists after login and reuses existing device record", async () => {
    const ip = getIp();
    const customDeviceName = "Pixel 8 Pro";
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
        deviceName: customDeviceName,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { deviceId } = JSON.parse(loginRes.payload);
    expect(deviceId).toBeDefined();

    const [deviceRow] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    expect(deviceRow).toBeDefined();
    expect(deviceRow.deviceName).toBe(customDeviceName);

    // Logging in again with the same deviceName reuses the same device ID
    const loginRes2 = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: ip,
      payload: {
        email: testUser.email,
        password: testUser.password,
        deviceName: customDeviceName,
      },
    });
    expect(loginRes2.statusCode).toBe(200);
    const { deviceId: deviceId2 } = JSON.parse(loginRes2.payload);
    expect(deviceId2).toBe(deviceId);
  });

  it("9. Rate limiting: 6th login in a minute returns 429", async () => {
    // Unique IP to isolate rate-limiting test
    const testIp = "192.0.2.222";
    let got429 = false;

    for (let i = 1; i <= 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress: testIp,
        payload: {
          email: "ratelimit@example.com",
          password: "wrong",
        },
      });

      if (res.statusCode === 429) {
        got429 = true;
        const body = JSON.parse(res.payload);
        expect(body.error).toBe("Too many requests, please try again later.");
        break;
      }
    }

    expect(got429).toBe(true);
  });

  it("10. Security headers present on /health", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
