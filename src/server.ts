import { Hono } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import type { AppConfig } from "./config.ts";
import type { Platform, RecentGistPlatformStatus, UserPreferences } from "./types.ts";
import { Store, type UserProfile } from "./db/store.ts";
import {
  buildAuthorizeUrl,
  encrypt,
  exchangeCode,
  fetchGitHubUser,
  type Session,
  SessionStore,
} from "./auth/mod.ts";
import { PublishEngine } from "./publisher/engine.ts";
import { ALL_PLATFORMS, getSetupInfo, PLATFORM_SETUP } from "./platforms/mod.ts";
import { buildUserPreferences } from "./platforms/setup.ts";
import { GistClient } from "./gist/mod.ts";

// ── Constants ────────────────────────────────────

/** GitHub gist IDs are lowercase hex strings, typically 20–32 chars. */
const GIST_ID_RE = /^[a-f0-9]{1,64}$/;

// ── Hono env type for typed context ──────────────

type Env = {
  Variables: {
    session: Session;
    userId: string;
  };
};

export function createApp(
  config: AppConfig,
  existingStore?: Store,
): { app: Hono<Env>; store: Store } {
  const app = new Hono<Env>();
  const store = existingStore ?? new Store();

  const getUserDefaultPlatforms = async (userId: string): Promise<Platform[]> => {
    const stored = await store.getPreferences(userId);
    return stored?.defaultPlatforms ?? config.defaults.publishPlatforms;
  };

  // ── Security headers ───────────────────────────

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
  });

  // ── Auth routes (no session required) ──────────

  app.get("/api/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  /** Redirect to GitHub OAuth — sets state cookie for CSRF protection. */
  app.get("/auth/login", (c) => {
    const state = crypto.randomUUID();
    const url = buildAuthorizeUrl(
      {
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret,
        redirectUri: `${config.server.baseUrl}/auth/callback`,
      },
      state,
    );
    const headers = new Headers();
    headers.set("Location", url);
    headers.set(
      "Set-Cookie",
      SessionStore.setOAuthStateCookie(state, config.server.isProduction),
    );
    return new Response(null, { status: 302, headers });
  });

  /** GitHub OAuth callback — validates state to prevent CSRF. */
  app.get("/auth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code) return c.json({ error: "Missing code parameter" }, 400);
    if (!state) return c.json({ error: "Missing state parameter" }, 400);

    // ── CSRF check: compare state param with cookie ──
    const cookieState = SessionStore.extractOAuthState(c.req.header("Cookie"));
    if (!cookieState || cookieState !== state) {
      return c.json(
        { error: "Invalid OAuth state — possible CSRF attack. Please try logging in again." },
        403,
      );
    }

    try {
      const tokenRes = await exchangeCode(
        {
          clientId: config.github.clientId,
          clientSecret: config.github.clientSecret,
          redirectUri: `${config.server.baseUrl}/auth/callback`,
        },
        code,
      );

      const ghUser = await fetchGitHubUser(tokenRes.access_token);
      const userId = String(ghUser.id);

      // Upsert user profile
      const profile: UserProfile = {
        id: userId,
        githubId: ghUser.id,
        login: ghUser.login,
        name: ghUser.name ?? ghUser.login,
        avatarUrl: ghUser.avatar_url,
        email: ghUser.email,
        createdAt: new Date().toISOString(),
      };
      const existing = await store.getUser(userId);
      if (existing) profile.createdAt = existing.createdAt;
      await store.saveUser(profile);

      // Create session
      const sessions = new SessionStore(store.kv);
      const sid = await sessions.create({
        userId,
        githubLogin: ghUser.login,
        githubToken: tokenRes.access_token,
        avatarUrl: ghUser.avatar_url,
        name: ghUser.name ?? ghUser.login,
        createdAt: new Date().toISOString(),
      });

      // Set session cookie AND clear the OAuth state cookie
      const headers = new Headers();
      headers.set("Location", "/");
      headers.append(
        "Set-Cookie",
        SessionStore.setCookie(sid, config.server.isProduction),
      );
      headers.append("Set-Cookie", SessionStore.clearOAuthStateCookie());
      return new Response(null, { status: 302, headers });
    } catch (_err) {
      // Don't leak internal error details to the client
      console.error("OAuth callback error:", (_err as Error).message);
      return c.json({ error: "Authentication failed. Please try again." }, 500);
    }
  });

  app.post("/auth/logout", async (c) => {
    const sid = SessionStore.extractId(c.req.header("Cookie"));
    if (sid) {
      const sessions = new SessionStore(store.kv);
      await sessions.destroy(sid);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": SessionStore.clearCookie(),
      },
    });
  });

  /** Check current session (unauthenticated-safe). */
  app.get("/api/me", async (c) => {
    const sid = SessionStore.extractId(c.req.header("Cookie"));
    if (!sid) {
      return c.json({
        user: null,
        defaults: buildUserPreferences(config.defaults.publishPlatforms),
      });
    }

    const sessions = new SessionStore(store.kv);
    const session = await sessions.get(sid);
    if (!session) {
      return c.json({
        user: null,
        defaults: buildUserPreferences(config.defaults.publishPlatforms),
      });
    }

    const profile = await store.getUser(session.userId);
    const userDefaults = await getUserDefaultPlatforms(session.userId);
    return c.json({
      user: profile
        ? {
          id: profile.id,
          login: profile.login,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        }
        : null,
      defaults: buildUserPreferences(userDefaults),
    });
  });

  // ── Auth middleware for /api/* (except health & me) ─

  app.use("/api/*", async (c, next) => {
    // Skip auth for health and me
    if (c.req.path === "/api/health" || c.req.path === "/api/me") {
      return next();
    }

    const sid = SessionStore.extractId(c.req.header("Cookie"));
    if (!sid) return c.json({ error: "Not authenticated" }, 401);

    const sessions = new SessionStore(store.kv);
    const session = await sessions.get(sid);
    if (!session) return c.json({ error: "Session expired" }, 401);

    c.set("session", session);
    c.set("userId", session.userId);
    return next();
  });

  // ── Platform setup wizard ──────────────────────

  /** List all platforms with setup info + user's config status. */
  app.get("/api/platforms", async (c) => {
    const userId = c.get("userId");
    const configured = await store.listConfiguredPlatforms(userId);

    const platforms = PLATFORM_SETUP.map((s) => ({
      ...s,
      configured: configured.includes(s.platform),
    }));

    return c.json({ platforms });
  });

  /** Get setup wizard fields for a single platform. */
  app.get("/api/platforms/:platform/setup", (c) => {
    const info = getSetupInfo(c.req.param("platform") as Platform);
    if (!info) return c.json({ error: "Unknown platform" }, 404);
    return c.json(info);
  });

  /** Save credentials for a platform (encrypt + store). */
  app.post("/api/platforms/:platform/setup", async (c) => {
    const platform = c.req.param("platform") as Platform;
    if (!ALL_PLATFORMS.includes(platform)) {
      return c.json({ error: "Unknown platform" }, 404);
    }

    const userId = c.get("userId");
    const body = await c.req.json();

    // Validate all required fields are present
    const info = getSetupInfo(platform)!;
    const missing = info.fields.filter((f) => !body[f.key]);
    if (missing.length > 0) {
      return c.json({
        error: `Missing fields: ${missing.map((f) => f.label).join(", ")}`,
      }, 400);
    }

    // Encrypt and store
    const blob = await encrypt(
      JSON.stringify(body),
      config.encryptionSecret,
      userId,
    );
    await store.setCredentials(userId, platform, blob);

    return c.json({ success: true, platform });
  });

  /** Remove credentials for a platform. */
  app.delete("/api/platforms/:platform", async (c) => {
    const platform = c.req.param("platform") as Platform;
    // Validate platform is known — don't write arbitrary keys to KV
    if (!ALL_PLATFORMS.includes(platform)) {
      return c.json({ error: "Unknown platform" }, 404);
    }
    const userId = c.get("userId");
    await store.deleteCredentials(userId, platform);
    return c.json({ success: true });
  });

  // ── S3 Storage config ─────────────────────────

  app.get("/api/storage", async (c) => {
    const userId = c.get("userId");
    const blob = await store.getStorageConfig(userId);
    return c.json({ configured: !!blob });
  });

  app.post("/api/storage", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json();

    const required = ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"];
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0) {
      return c.json({ error: `Missing: ${missing.join(", ")}` }, 400);
    }

    const blob = await encrypt(
      JSON.stringify(body),
      config.encryptionSecret,
      userId,
    );
    await store.setStorageConfig(userId, blob);
    return c.json({ success: true });
  });

  app.delete("/api/storage", async (c) => {
    const userId = c.get("userId");
    await store.deleteStorageConfig(userId);
    return c.json({ success: true });
  });

  // ── User preferences ──────────────────────────

  app.get("/api/preferences", async (c) => {
    const userId = c.get("userId");
    const preferences: UserPreferences = {
      defaultPlatforms: await getUserDefaultPlatforms(userId),
    };
    return c.json({ preferences });
  });

  app.put("/api/preferences", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json();
    const defaultPlatforms = body?.defaultPlatforms;

    if (!Array.isArray(defaultPlatforms)) {
      return c.json({ error: "defaultPlatforms must be an array" }, 400);
    }

    const invalid = defaultPlatforms.filter((platform: unknown) =>
      typeof platform !== "string" || !ALL_PLATFORMS.includes(platform as Platform)
    );
    if (invalid.length > 0) {
      return c.json({ error: `Unsupported platforms: ${invalid.join(", ")}` }, 400);
    }

    const uniqueDefaults = Array.from(new Set(defaultPlatforms as Platform[]));
    const configured = await store.listConfiguredPlatforms(userId);
    const unconfigured = uniqueDefaults.filter((platform) => !configured.includes(platform));
    if (unconfigured.length > 0) {
      return c.json({ error: `Platforms not configured: ${unconfigured.join(", ")}` }, 400);
    }

    const preferences: UserPreferences = { defaultPlatforms: uniqueDefaults };
    await store.setPreferences(userId, preferences);
    return c.json({ preferences });
  });

  // ── Gists ─────────────────────────────────────

  app.get("/api/gists/recent", async (c) => {
    const session = c.get("session");
    const userId = c.get("userId");
    const client = new GistClient({ token: session.githubToken });
    const limitParam = c.req.query("limit");
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit!, 50)) : 10;

    try {
      const [gists, recentFromStore] = await Promise.all([
        client.listRecentPublishableGists({ limit }),
        store.getRecentGists(userId),
      ]);

      const storeByGistId = new Map(
        recentFromStore.map((gist) => [gist.id, gist]),
      );
      const enriched = gists.map((gist) => {
        const fromStore = storeByGistId.get(gist.id);
        const platformStatuses: RecentGistPlatformStatus[] =
          fromStore?.publishedPlatforms.map((platform) => ({
            platform,
            status: "published",
          })) ?? [];

        return {
          ...gist,
          publishedPlatforms: fromStore?.publishedPlatforms ?? [],
          platformStatuses,
        };
      });

      return c.json({ gists: enriched });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ── Publications ──────────────────────────────

  app.get("/api/publications", async (c) => {
    const pubs = await store.getAll(c.get("userId"));
    return c.json({ publications: pubs });
  });

  app.get("/api/publications/:id", async (c) => {
    const pub = await store.get(c.get("userId"), c.req.param("id"));
    if (!pub) return c.json({ error: "Not found" }, 404);
    return c.json(pub);
  });

  app.post("/api/publish", async (c) => {
    const body = await c.req.json();
    const gistId = body.gistId;
    if (!gistId || typeof gistId !== "string") {
      return c.json({ error: "gistId is required" }, 400);
    }

    // Validate gistId format to prevent SSRF via path traversal
    if (!GIST_ID_RE.test(gistId)) {
      return c.json({ error: "Invalid gistId format" }, 400);
    }

    const session = c.get("session");
    const engine = new PublishEngine({
      githubToken: session.githubToken,
      userId: session.userId,
      store,
      encryptionSecret: config.encryptionSecret,
    });

    try {
      const publication = await engine.processGist(gistId, {
        defaultPlatforms: await getUserDefaultPlatforms(session.userId),
      });
      return c.json({ publication });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/publications/:id/retry", async (c) => {
    const pub = await store.get(c.get("userId"), c.req.param("id"));
    if (!pub) return c.json({ error: "Not found" }, 404);

    const session = c.get("session");
    const engine = new PublishEngine({
      githubToken: session.githubToken,
      userId: session.userId,
      store,
      encryptionSecret: config.encryptionSecret,
    });

    try {
      const updated = await engine.processGist(pub.gistId, {
        defaultPlatforms: await getUserDefaultPlatforms(session.userId),
      });
      return c.json({ publication: updated });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.delete("/api/publications/:id", async (c) => {
    const deleted = await store.delete(c.get("userId"), c.req.param("id"));
    if (!deleted) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });

  // ── Static files ──────────────────────────────

  app.use("/*", serveStatic({ root: "./dist" }));
  app.use("/", serveStatic({ root: "./dist", path: "/index.html" }));

  return { app, store };
}
