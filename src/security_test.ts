/**
 * Security-focused tests: cross-user isolation, CSRF protection,
 * input validation, session safety, and credential boundaries.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { createApp } from "./server.ts";
import { Store } from "./db/store.ts";
import { SessionStore } from "./auth/session.ts";
import { encrypt } from "./auth/crypto.ts";
import type { AppConfig } from "./config.ts";
import type { Publication } from "./types.ts";

const ENCRYPTION_SECRET = "test-encryption-secret-for-security-tests";

function testConfig(): AppConfig {
  return {
    server: {
      port: 0,
      host: "127.0.0.1",
      baseUrl: "http://localhost:0",
      isProduction: false,
    },
    github: { clientId: "test-id", clientSecret: "test-secret" },
    push: {
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "",
    },
    encryptionSecret: ENCRYPTION_SECRET,
    defaults: { publishPlatforms: [] },
  };
}

async function setup() {
  const store = new Store(":memory:");
  await store.init();
  const { app } = createApp(testConfig(), store);
  return { app, store };
}

async function createSession(
  store: Store,
  userId: string,
  login: string,
) {
  const sessions = new SessionStore(store.kv);
  const sid = await sessions.create({
    userId,
    githubLogin: login,
    githubToken: `ghp_test_${userId}`,
    avatarUrl: `https://example.com/${login}.png`,
    name: `${login}`,
    createdAt: new Date().toISOString(),
  });
  return `sid=${sid}`;
}

function makePub(userId: string, id: string, gistId: string): Publication {
  return {
    id,
    gistId,
    userId,
    content: {
      meta: { title: "Test", type: "post", platforms: ["twitter"] },
      body: "body",
      raw: "---\ntitle: Test\ntype: post\nplatforms: [twitter]\n---\nbody",
    },
    media: [],
    platforms: [
      { platform: "twitter", status: "published", retryCount: 0 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════
// Cross-User Publication Isolation
// ═══════════════════════════════════════════════════

Deno.test("Security: user A cannot read user B's publications", async () => {
  const { app, store } = await setup();
  const cookieA = await createSession(store, "alice", "alice");
  const cookieB = await createSession(store, "bob", "bob");

  // Bob saves a publication
  await store.save("bob", makePub("bob", "bob-pub-1", "gist-bob-1"));

  // Alice can't read Bob's publication by ID
  const res = await app.request("/api/publications/bob-pub-1", {
    headers: { Cookie: cookieA },
  });
  assertEquals(res.status, 404);

  // Alice's list is empty
  const listRes = await app.request("/api/publications", {
    headers: { Cookie: cookieA },
  });
  assertEquals((await listRes.json()).publications.length, 0);

  // Bob CAN see his own
  const bobRes = await app.request("/api/publications/bob-pub-1", {
    headers: { Cookie: cookieB },
  });
  assertEquals(bobRes.status, 200);

  store.close();
});

Deno.test("Security: user A cannot delete user B's publications", async () => {
  const { app, store } = await setup();
  const cookieA = await createSession(store, "alice", "alice");
  await createSession(store, "bob", "bob");

  await store.save("bob", makePub("bob", "bob-pub-2", "gist-bob-2"));

  // Alice tries to delete Bob's publication
  const res = await app.request("/api/publications/bob-pub-2", {
    method: "DELETE",
    headers: { Cookie: cookieA },
  });
  assertEquals(res.status, 404); // not found — scoped to Alice's namespace

  // Bob's publication still exists
  const pub = await store.get("bob", "bob-pub-2");
  assertEquals(pub?.id, "bob-pub-2");

  store.close();
});

// ═══════════════════════════════════════════════════
// Cross-User Credential Isolation
// ═══════════════════════════════════════════════════

Deno.test("Security: user A cannot see user B's configured platforms", async () => {
  const { app, store } = await setup();
  const cookieA = await createSession(store, "alice", "alice");
  const cookieB = await createSession(store, "bob", "bob");

  // Bob configures Bluesky
  const blob = await encrypt(
    JSON.stringify({ handle: "bob.bsky.social", appPassword: "secret" }),
    ENCRYPTION_SECRET,
    "bob",
  );
  await store.setCredentials("bob", "bluesky", blob);

  // Alice sees all platforms as unconfigured
  const aliceRes = await app.request("/api/platforms", {
    headers: { Cookie: cookieA },
  });
  const alicePlats = await aliceRes.json();
  assertEquals(
    alicePlats.platforms.every((p: { configured: boolean }) => !p.configured),
    true,
  );

  // Bob sees Bluesky as configured
  const bobRes = await app.request("/api/platforms", {
    headers: { Cookie: cookieB },
  });
  const bobPlats = await bobRes.json();
  const bs = bobPlats.platforms.find(
    (p: { platform: string }) => p.platform === "bluesky",
  );
  assertEquals(bs.configured, true);

  store.close();
});

Deno.test("Security: credentials encrypted with per-user salt cannot be decrypted by another user", async () => {
  const { store } = await setup();

  // Encrypt with Alice's userId as salt
  const blob = await encrypt(
    '{"apiKey":"super-secret"}',
    ENCRYPTION_SECRET,
    "alice",
  );
  await store.setCredentials("alice", "twitter", blob);

  // Even if someone reads the raw blob, decrypting with Bob's salt fails
  const { decrypt } = await import("./auth/crypto.ts");
  await assertRejects(
    () => decrypt(blob, ENCRYPTION_SECRET, "bob"),
    Error,
  );

  store.close();
});

// ═══════════════════════════════════════════════════
// Cross-User Storage Config Isolation
// ═══════════════════════════════════════════════════

Deno.test("Security: user A cannot see user B's storage config", async () => {
  const { app, store } = await setup();
  const cookieA = await createSession(store, "alice", "alice");
  const cookieB = await createSession(store, "bob", "bob");

  // Bob configures S3
  const blob = await encrypt(
    JSON.stringify({
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "bobs-bucket",
      accessKeyId: "BOB_KEY",
      secretAccessKey: "BOB_SECRET",
    }),
    ENCRYPTION_SECRET,
    "bob",
  );
  await store.setStorageConfig("bob", blob);

  // Alice sees unconfigured
  const aliceRes = await app.request("/api/storage", {
    headers: { Cookie: cookieA },
  });
  assertEquals((await aliceRes.json()).configured, false);

  // Bob sees configured
  const bobRes = await app.request("/api/storage", {
    headers: { Cookie: cookieB },
  });
  assertEquals((await bobRes.json()).configured, true);

  store.close();
});

// ═══════════════════════════════════════════════════
// Session Security
// ═══════════════════════════════════════════════════

Deno.test("Security: forged session ID returns 401", async () => {
  const { app, store } = await setup();

  const res = await app.request("/api/publications", {
    headers: { Cookie: "sid=00000000-0000-0000-0000-000000000000" },
  });
  assertEquals(res.status, 401);

  store.close();
});

Deno.test("Security: non-UUID session cookie is rejected", async () => {
  const { app, store } = await setup();

  // Malformed session IDs should be rejected before KV lookup
  for (
    const badSid of [
      "sid=not-a-uuid",
      "sid=../../../etc/passwd",
      "sid=<script>alert(1)</script>",
      "sid=",
      "sid=a".repeat(1000),
    ]
  ) {
    const res = await app.request("/api/publications", {
      headers: { Cookie: badSid },
    });
    assertEquals(res.status, 401, `Expected 401 for cookie: ${badSid}`);
  }

  store.close();
});

Deno.test("Security: destroyed session cannot be reused", async () => {
  const { app, store } = await setup();
  const cookie = await createSession(store, "alice", "alice");

  // Works initially
  const res1 = await app.request("/api/publications", {
    headers: { Cookie: cookie },
  });
  assertEquals(res1.status, 200);

  // Logout
  await app.request("/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });

  // Same session cookie now fails
  const res2 = await app.request("/api/publications", {
    headers: { Cookie: cookie },
  });
  assertEquals(res2.status, 401);

  store.close();
});

// ═══════════════════════════════════════════════════
// OAuth State / CSRF Protection
// ═══════════════════════════════════════════════════

Deno.test("Security: /auth/login sets OAuth state cookie", async () => {
  const { app, store } = await setup();

  const res = await app.request("/auth/login");
  assertEquals(res.status, 302);

  const location = res.headers.get("Location")!;
  assertEquals(location.includes("github.com/login/oauth/authorize"), true);

  // Extract state from the redirect URL
  const urlState = new URL(location).searchParams.get("state");
  assertEquals(typeof urlState, "string");
  assertEquals(urlState!.length > 0, true);

  // Check that the Set-Cookie header contains the same state
  const cookie = res.headers.get("Set-Cookie")!;
  assertEquals(cookie.includes("__oauth_state="), true);
  assertEquals(cookie.includes(urlState!), true);
  assertEquals(cookie.includes("HttpOnly"), true);
  assertEquals(cookie.includes("SameSite=Lax"), true);

  store.close();
});

Deno.test("Security: /auth/callback rejects missing state parameter", async () => {
  const { app, store } = await setup();

  const res = await app.request("/auth/callback?code=test-code");
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Missing state parameter");

  store.close();
});

Deno.test("Security: /auth/callback rejects mismatched state (CSRF)", async () => {
  const { app, store } = await setup();

  // Send a callback with a state that doesn't match the cookie
  const res = await app.request("/auth/callback?code=test-code&state=attacker-state", {
    headers: { Cookie: "__oauth_state=real-state" },
  });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.includes("CSRF"), true);

  store.close();
});

Deno.test("Security: /auth/callback rejects request with no state cookie", async () => {
  const { app, store } = await setup();

  const res = await app.request("/auth/callback?code=test-code&state=some-state");
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.includes("CSRF"), true);

  store.close();
});

// ═══════════════════════════════════════════════════
// Input Validation
// ═══════════════════════════════════════════════════

Deno.test("Security: /api/publish rejects path traversal in gistId", async () => {
  const { app, store } = await setup();
  const cookie = await createSession(store, "alice", "alice");

  for (
    const badId of [
      "../users",
      "abc/../../admin",
      "abc def",
      "<script>",
      "gist123!@#",
    ]
  ) {
    const res = await app.request("/api/publish", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ gistId: badId }),
    });
    assertEquals(res.status, 400, `Expected 400 for gistId: ${badId}`);
    assertEquals((await res.json()).error, "Invalid gistId format");
  }

  store.close();
});

Deno.test("Security: /api/publish accepts valid hex gist IDs", async () => {
  const { app, store } = await setup();
  const cookie = await createSession(store, "alice", "alice");

  // Valid format but will fail at GitHub API call — that's OK, we just check it passes validation
  const res = await app.request("/api/publish", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ gistId: "aa5a315d61ae9438b18d" }),
  });
  // Should NOT be 400 "Invalid gistId format"
  const body = await res.json();
  assertEquals(body.error !== "Invalid gistId format", true);

  store.close();
});

Deno.test("Security: DELETE /api/platforms/:platform rejects unknown platform", async () => {
  const { app, store } = await setup();
  const cookie = await createSession(store, "alice", "alice");

  for (const bad of ["../../admin", "EVIL", "not-a-platform"]) {
    const res = await app.request(`/api/platforms/${bad}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 404, `Expected 404 for platform: ${bad}`);
  }

  store.close();
});

// ═══════════════════════════════════════════════════
// Security Headers
// ═══════════════════════════════════════════════════

Deno.test("Security: responses include security headers", async () => {
  const { app, store } = await setup();

  const res = await app.request("/api/health");
  assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(res.headers.get("X-Frame-Options"), "DENY");
  assertEquals(
    res.headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assertEquals(res.headers.get("X-XSS-Protection"), "1; mode=block");

  store.close();
});

Deno.test("Security: no CORS Access-Control-Allow-Origin header on responses", async () => {
  const { app, store } = await setup();

  const res = await app.request("/api/health");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);

  store.close();
});

// ═══════════════════════════════════════════════════
// Store Defense-in-Depth
// ═══════════════════════════════════════════════════

Deno.test("Security: store.save rejects mismatched userId", async () => {
  const store = new Store(":memory:");
  await store.init();

  const pub = makePub("bob", "pub-1", "gist-1");

  // Trying to save Bob's publication under Alice's namespace should throw
  await assertRejects(
    () => store.save("alice", pub),
    Error,
    "Security violation",
  );

  store.close();
});

Deno.test("Security: store credential isolation between users", async () => {
  const store = new Store(":memory:");
  await store.init();

  const aliceBlob = { ct: "alice-encrypted", iv: "alice-iv" };
  const bobBlob = { ct: "bob-encrypted", iv: "bob-iv" };

  await store.setCredentials("alice", "twitter", aliceBlob);
  await store.setCredentials("bob", "twitter", bobBlob);

  // Each user sees only their own
  assertEquals(await store.getCredentials("alice", "twitter"), aliceBlob);
  assertEquals(await store.getCredentials("bob", "twitter"), bobBlob);

  // Delete Alice's doesn't affect Bob's
  await store.deleteCredentials("alice", "twitter");
  assertEquals(await store.getCredentials("alice", "twitter"), undefined);
  assertEquals(await store.getCredentials("bob", "twitter"), bobBlob);

  store.close();
});

Deno.test("Security: store storage config isolation between users", async () => {
  const store = new Store(":memory:");
  await store.init();

  const aliceBlob = { ct: "alice-s3", iv: "iv-a" };
  const bobBlob = { ct: "bob-s3", iv: "iv-b" };

  await store.setStorageConfig("alice", aliceBlob);
  await store.setStorageConfig("bob", bobBlob);

  assertEquals(await store.getStorageConfig("alice"), aliceBlob);
  assertEquals(await store.getStorageConfig("bob"), bobBlob);

  await store.deleteStorageConfig("alice");
  assertEquals(await store.getStorageConfig("alice"), undefined);
  assertEquals(await store.getStorageConfig("bob"), bobBlob);

  store.close();
});

Deno.test("Security: listConfiguredPlatforms is user-scoped", async () => {
  const store = new Store(":memory:");
  await store.init();

  await store.setCredentials("alice", "twitter", { ct: "a", iv: "a" });
  await store.setCredentials("alice", "bluesky", { ct: "a", iv: "a" });
  await store.setCredentials("bob", "mastodon", { ct: "b", iv: "b" });

  const alicePlats = await store.listConfiguredPlatforms("alice");
  const bobPlats = await store.listConfiguredPlatforms("bob");

  assertEquals(alicePlats.sort(), ["bluesky", "twitter"]);
  assertEquals(bobPlats, ["mastodon"]);

  store.close();
});
