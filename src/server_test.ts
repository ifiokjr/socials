import { assertEquals } from "@std/assert";
import { createApp } from "./server.ts";
import { Store } from "./db/store.ts";
import { SessionStore } from "./auth/session.ts";
import type { AppConfig } from "./config.ts";

function testConfig(): AppConfig {
  return {
    server: { port: 0, host: "127.0.0.1", baseUrl: "http://localhost:0", isProduction: false },
    github: { clientId: "test-id", clientSecret: "test-secret" },
    push: {
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "",
    },
    encryptionSecret: "test-encryption-secret-for-unit-tests",
    defaults: {
      publishPlatforms: ["twitter"],
    },
  };
}

async function setup() {
  const store = new Store(":memory:");
  await store.init();
  const { app } = createApp(testConfig(), store);
  return { app, store };
}

/** Create a real session in KV and return the cookie string. */
async function withSession(store: Store) {
  const sessions = new SessionStore(store.kv);
  const sid = await sessions.create({
    userId: "42",
    githubLogin: "testuser",
    githubToken: "ghp_test",
    avatarUrl: "https://example.com/a.png",
    name: "Test User",
    createdAt: new Date().toISOString(),
  });
  return { cookie: `sid=${sid}`, userId: "42" };
}

// ── Unauthenticated routes ──────────────────────

Deno.test("GET /api/health returns ok", async () => {
  const { app, store } = await setup();
  const res = await app.request("/api/health");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "ok");
  store.close();
});

Deno.test("GET /api/me returns null user and app defaults without session", async () => {
  const { app, store } = await setup();
  const res = await app.request("/api/me");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.user, null);
  assertEquals(body.defaults.defaultPlatforms, ["twitter"]);
  store.close();
});

Deno.test("GET /api/me returns user defaults when preferences exist", async () => {
  const { app, store } = await setup();
  const { cookie, userId } = await withSession(store);

  await store.setPreferences(userId, { defaultPlatforms: ["bluesky"] });

  const res = await app.request("/api/me", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.defaults.defaultPlatforms, ["bluesky"]);

  store.close();
});

// ── Auth required ───────────────────────────────

Deno.test("GET /api/publications returns 401 without session", async () => {
  const { app, store } = await setup();
  const res = await app.request("/api/publications");
  assertEquals(res.status, 401);
  store.close();
});

Deno.test("GET /api/platforms returns 401 without session", async () => {
  const { app, store } = await setup();
  const res = await app.request("/api/platforms");
  assertEquals(res.status, 401);
  store.close();
});

Deno.test("POST /api/publish returns 401 without session", async () => {
  const { app, store } = await setup();
  const res = await app.request("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gistId: "abc" }),
  });
  assertEquals(res.status, 401);
  store.close();
});

// ── With session ────────────────────────────────

Deno.test("GET /api/publications returns empty with session", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/publications", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).publications, []);
  store.close();
});

Deno.test("GET /api/platforms lists all 11 with session", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/platforms", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.platforms.length, 11);
  assertEquals(body.platforms.every((p: { configured: boolean }) => !p.configured), true);
  store.close();
});

Deno.test("POST /api/publish requires gistId", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/publish", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "gistId is required");
  store.close();
});

Deno.test("GET /api/publications/:id returns 404", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/publications/missing", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 404);
  store.close();
});

Deno.test("DELETE /api/publications/:id returns 404", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/publications/missing", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 404);
  store.close();
});

// ── Platform setup ──────────────────────────────

Deno.test("POST /api/platforms/:platform/setup saves credentials", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/platforms/bluesky/setup", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "me.bsky.social", appPassword: "xxxx-xxxx" }),
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).success, true);

  // Verify it shows as configured now
  const platsRes = await app.request("/api/platforms", {
    headers: { Cookie: cookie },
  });
  const plats = await platsRes.json();
  const bs = plats.platforms.find((p: { platform: string }) => p.platform === "bluesky");
  assertEquals(bs.configured, true);

  store.close();
});

Deno.test("POST /api/platforms/:platform/setup validates required fields", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/platforms/bluesky/setup", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "me.bsky.social" }), // missing appPassword
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.includes("Missing"), true);

  store.close();
});

Deno.test("DELETE /api/platforms/:platform removes credentials", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  // Set up first
  await app.request("/api/platforms/mastodon/setup", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      instanceUrl: "https://mastodon.social",
      accessToken: "tok",
    }),
  });

  // Delete
  const res = await app.request("/api/platforms/mastodon", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);

  store.close();
});

// ── Storage config ──────────────────────────────

Deno.test("Storage config CRUD via API", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  // Not configured initially
  let res = await app.request("/api/storage", { headers: { Cookie: cookie } });
  assertEquals((await res.json()).configured, false);

  // Save
  res = await app.request("/api/storage", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://s3.us-east-1.amazonaws.com",
      region: "us-east-1",
      bucket: "my-bucket",
      accessKeyId: "AKIA...",
      secretAccessKey: "secret",
    }),
  });
  assertEquals(res.status, 200);

  // Now configured
  res = await app.request("/api/storage", { headers: { Cookie: cookie } });
  assertEquals((await res.json()).configured, true);

  // Delete
  res = await app.request("/api/storage", {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);

  store.close();
});

Deno.test("GET /api/preferences returns app defaults when user has none", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/preferences", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).preferences.defaultPlatforms, ["twitter"]);

  store.close();
});

Deno.test("PUT /api/preferences saves user defaults", async () => {
  const { app, store } = await setup();
  const { cookie, userId } = await withSession(store);

  await app.request("/api/platforms/bluesky/setup", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ handle: "me.bsky.social", appPassword: "xxxx-xxxx" }),
  });

  const res = await app.request("/api/preferences", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ defaultPlatforms: ["bluesky", "bluesky"] }),
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).preferences.defaultPlatforms, ["bluesky"]);

  const stored = await store.getPreferences(userId);
  assertEquals(stored?.defaultPlatforms, ["bluesky"]);

  store.close();
});

Deno.test("PUT /api/preferences rejects unsupported platforms", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/preferences", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ defaultPlatforms: ["myspace"] }),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.includes("Unsupported platforms"), true);

  store.close();
});

Deno.test("PUT /api/preferences rejects unconfigured platforms", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/preferences", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ defaultPlatforms: ["twitter"] }),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.includes("Platforms not configured"), true);

  store.close();
});

Deno.test("GET /api/push/public-key returns 503 when not configured", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/push/public-key", {
    headers: { Cookie: cookie },
  });
  assertEquals(res.status, 503);

  store.close();
});

Deno.test("Push subscription endpoints save and remove subscription", async () => {
  const { app, store } = await setup();
  const { cookie, userId } = await withSession(store);

  const subscribeRes = await app.request("/api/push/subscribe", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://example.push/sub/123",
      expirationTime: null,
      keys: {
        p256dh: "test-p256dh",
        auth: "test-auth",
      },
    }),
  });
  assertEquals(subscribeRes.status, 200);

  const subscriptions = await store.listPushSubscriptions(userId);
  assertEquals(subscriptions.length, 1);
  assertEquals(subscriptions[0].endpoint, "https://example.push/sub/123");

  const unsubscribeRes = await app.request("/api/push/unsubscribe", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "https://example.push/sub/123" }),
  });
  assertEquals(unsubscribeRes.status, 200);

  const after = await store.listPushSubscriptions(userId);
  assertEquals(after.length, 0);

  store.close();
});

Deno.test("Push subscribe rejects invalid endpoint and keys", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const invalidEndpoint = await app.request("/api/push/subscribe", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: "http://insecure.example/sub",
      expirationTime: null,
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    }),
  });
  assertEquals(invalidEndpoint.status, 400);

  const invalidKeys = await app.request("/api/push/subscribe", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: "https://example.push/sub/234",
      expirationTime: null,
      keys: { p256dh: "***", auth: "***" },
    }),
  });
  assertEquals(invalidKeys.status, 400);

  store.close();
});

Deno.test("POST /api/push/test returns 503 when push is not configured", async () => {
  const { app, store } = await setup();
  const { cookie } = await withSession(store);

  const res = await app.request("/api/push/test", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "hello" }),
  });
  assertEquals(res.status, 503);

  store.close();
});
