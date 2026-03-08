/**
 * Cookie-based session management backed by Deno KV.
 *
 * KV layout:
 *   ["sessions", sessionId]  →  Session
 */

export interface Session {
  userId: string;
  githubLogin: string;
  githubToken: string;
  avatarUrl: string;
  name: string;
  createdAt: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "sid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionStore {
  #kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  /** Create a new session, returning the session id. */
  async create(session: Session): Promise<string> {
    const id = crypto.randomUUID();
    await this.#kv.set(["sessions", id], session, {
      expireIn: SESSION_TTL_MS,
    });
    return id;
  }

  /** Look up a session by id. Returns null if expired / missing. */
  async get(id: string): Promise<Session | null> {
    const entry = await this.#kv.get<Session>(["sessions", id]);
    return entry.value;
  }

  /** Destroy a session. */
  async destroy(id: string): Promise<void> {
    await this.#kv.delete(["sessions", id]);
  }

  // ── Cookie helpers ─────────────────────────────

  /** Build a Set-Cookie header value. */
  static setCookie(sessionId: string, secure: boolean): string {
    const parts = [
      `${COOKIE_NAME}=${sessionId}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  /** Build a Set-Cookie that clears the session. */
  static clearCookie(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** Build a Set-Cookie that sets the OAuth state for CSRF protection. */
  static setOAuthStateCookie(state: string, secure: boolean): string {
    const parts = [
      `__oauth_state=${state}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=600", // 10 minutes
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  /** Build a Set-Cookie that clears the OAuth state. */
  static clearOAuthStateCookie(): string {
    return "__oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  }

  /** Extract the OAuth state from a Cookie header string. */
  static extractOAuthState(cookieHeader: string | null | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/(?:^|;\s*)__oauth_state=([^;]+)/);
    return match?.[1] ?? null;
  }

  /** Extract the session id from a Cookie header string. */
  static extractId(cookieHeader: string | null | undefined): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    const id = match?.[1] ?? null;
    // Validate UUID format to prevent arbitrary KV lookups
    if (id && !UUID_RE.test(id)) return null;
    return id;
  }
}
