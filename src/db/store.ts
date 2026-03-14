import type { EncryptedBlob } from "../auth/crypto.ts";
import type {
  Platform,
  Publication,
  RecentGist,
  StoredPushSubscription,
  UserPreferences,
} from "../types.ts";

/**
 * Multi-tenant Deno KV store.
 *
 * Key layout — every user key is prefixed by userId:
 *
 *   ["users", odv"userId"]                          →  UserProfile
 *   ["publications", userId, pubId]              →  Publication
 *   ["pub_by_gist", userId, gistId]              →  pubId
 *   ["credentials", userId, platform]            →  EncryptedBlob
 *   ["storage_config", userId]                   →  EncryptedBlob  (S3-compat cfg)
 *   ["preferences", userId]                      →  UserPreferences
 *   ["push_subscriptions", userId, endpoint]     →  StoredPushSubscription
 *   ["sessions", sessionId]                      →  Session        (see session.ts)
 */
export class Store {
  #kv: Deno.Kv | null = null;
  #path: string | undefined;

  constructor(path?: string) {
    this.#path = path;
  }

  async init(): Promise<void> {
    this.#kv = await Deno.openKv(this.#path);
  }

  get kv(): Deno.Kv {
    if (!this.#kv) throw new Error("Store not initialised — call init() first");
    return this.#kv;
  }

  // ── User Profile ───────────────────────────────

  async getUser(userId: string): Promise<UserProfile | undefined> {
    const r = await this.kv.get<UserProfile>(["users", userId]);
    return r.value ?? undefined;
  }

  async saveUser(user: UserProfile): Promise<void> {
    await this.kv.set(["users", user.id], user);
  }

  // ── Publications (per-user) ────────────────────

  async getAll(userId: string): Promise<Publication[]> {
    const pubs: Publication[] = [];
    const iter = this.kv.list<Publication>({ prefix: ["publications", userId] });
    for await (const entry of iter) {
      pubs.push(entry.value);
    }
    pubs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return pubs;
  }

  async get(userId: string, id: string): Promise<Publication | undefined> {
    const r = await this.kv.get<Publication>(["publications", userId, id]);
    return r.value ?? undefined;
  }

  async getByGistId(userId: string, gistId: string): Promise<Publication | undefined> {
    const ref = await this.kv.get<string>(["pub_by_gist", userId, gistId]);
    if (!ref.value) return undefined;
    return this.get(userId, ref.value);
  }

  async getRecentGists(userId: string): Promise<RecentGist[]> {
    const pubs = await this.getAll(userId);
    const byGist = new Map<string, RecentGist>();

    for (const pub of pubs) {
      const publishedPlatforms = pub.platforms
        .filter((p) => p.status === "published")
        .map((p) => p.platform);

      const existing = byGist.get(pub.gistId);
      if (existing) {
        const merged = new Set<Platform>([
          ...existing.publishedPlatforms,
          ...publishedPlatforms,
        ]);
        existing.publishedPlatforms = Array.from(merged);
        continue;
      }

      byGist.set(pub.gistId, {
        id: pub.gistId,
        description: pub.content.meta.title || `Gist ${pub.gistId.slice(0, 8)}`,
        htmlUrl: `https://gist.github.com/${pub.gistId}`,
        updatedAt: pub.updatedAt,
        publishedPlatforms: Array.from(new Set<Platform>(publishedPlatforms)),
        ownerLogin: undefined,
        markdownFiles: [],
      });
    }

    return Array.from(byGist.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async save(userId: string, publication: Publication): Promise<void> {
    // Defense-in-depth: prevent cross-tenant data contamination
    if (publication.userId && publication.userId !== userId) {
      throw new Error(
        "Security violation: publication userId does not match requesting userId",
      );
    }

    const existing = await this.kv.get<Publication>(
      ["publications", userId, publication.id],
    );
    const atomic = this.kv.atomic();

    if (existing.value && existing.value.gistId !== publication.gistId) {
      atomic.delete(["pub_by_gist", userId, existing.value.gistId]);
    }

    atomic
      .set(["publications", userId, publication.id], publication)
      .set(["pub_by_gist", userId, publication.gistId], publication.id);

    const result = await atomic.commit();
    if (!result.ok) throw new Error("KV atomic commit failed");
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const existing = await this.kv.get<Publication>(["publications", userId, id]);
    if (!existing.value) return false;

    const pub = existing.value;
    const result = await this.kv.atomic()
      .delete(["publications", userId, id])
      .delete(["pub_by_gist", userId, pub.gistId])
      .commit();
    return result.ok;
  }

  async clear(userId: string): Promise<void> {
    for (const prefix of [["publications", userId], ["pub_by_gist", userId]]) {
      const iter = this.kv.list({ prefix });
      for await (const entry of iter) {
        await this.kv.delete(entry.key);
      }
    }
  }

  // ── Platform Credentials (encrypted) ──────────

  async getCredentials(
    userId: string,
    platform: Platform,
  ): Promise<EncryptedBlob | undefined> {
    const r = await this.kv.get<EncryptedBlob>(["credentials", userId, platform]);
    return r.value ?? undefined;
  }

  async setCredentials(
    userId: string,
    platform: Platform,
    blob: EncryptedBlob,
  ): Promise<void> {
    await this.kv.set(["credentials", userId, platform], blob);
  }

  async deleteCredentials(userId: string, platform: Platform): Promise<void> {
    await this.kv.delete(["credentials", userId, platform]);
  }

  async listConfiguredPlatforms(userId: string): Promise<Platform[]> {
    const platforms: Platform[] = [];
    const iter = this.kv.list<EncryptedBlob>({ prefix: ["credentials", userId] });
    for await (const entry of iter) {
      platforms.push(entry.key[2] as Platform);
    }
    return platforms;
  }

  // ── S3-Compatible Storage Config (encrypted) ──

  async getStorageConfig(userId: string): Promise<EncryptedBlob | undefined> {
    const r = await this.kv.get<EncryptedBlob>(["storage_config", userId]);
    return r.value ?? undefined;
  }

  async setStorageConfig(userId: string, blob: EncryptedBlob): Promise<void> {
    await this.kv.set(["storage_config", userId], blob);
  }

  async deleteStorageConfig(userId: string): Promise<void> {
    await this.kv.delete(["storage_config", userId]);
  }

  // ── User Preferences ───────────────────────────

  async getPreferences(userId: string): Promise<UserPreferences | undefined> {
    const r = await this.kv.get<UserPreferences>(["preferences", userId]);
    return r.value ?? undefined;
  }

  async setPreferences(userId: string, preferences: UserPreferences): Promise<void> {
    await this.kv.set(["preferences", userId], preferences);
  }

  // ── Push Subscriptions ─────────────────────────

  async savePushSubscription(
    userId: string,
    subscription: Omit<StoredPushSubscription, "createdAt" | "updatedAt">,
  ): Promise<StoredPushSubscription> {
    const now = new Date().toISOString();
    const key = ["push_subscriptions", userId, subscription.endpoint] as const;
    const existing = await this.kv.get<StoredPushSubscription>(key);

    const next: StoredPushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: subscription.keys,
      createdAt: existing.value?.createdAt ?? now,
      updatedAt: now,
    };

    await this.kv.set(key, next);
    return next;
  }

  async listPushSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
    const subscriptions: StoredPushSubscription[] = [];
    const iter = this.kv.list<StoredPushSubscription>({
      prefix: ["push_subscriptions", userId],
    });

    for await (const entry of iter) {
      subscriptions.push(entry.value);
    }

    subscriptions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return subscriptions;
  }

  async removePushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const key = ["push_subscriptions", userId, endpoint] as const;
    const existing = await this.kv.get<StoredPushSubscription>(key);
    if (!existing.value) return false;

    await this.kv.delete(key);
    return true;
  }

  // ── Lifecycle ──────────────────────────────────

  close(): void {
    this.#kv?.close();
    this.#kv = null;
  }
}

/** Stored user profile. */
export interface UserProfile {
  id: string;
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
  email: string | null;
  createdAt: string;
}
