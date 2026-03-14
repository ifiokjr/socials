import { GistClient } from "../gist/client.ts";
import { parseGistContent } from "../gist/parser.ts";
import { guessMimeType, S3Client } from "../storage/s3.ts";
import { buildAdapter } from "../platforms/mod.ts";
import { decrypt } from "../auth/crypto.ts";
import { Store } from "../db/store.ts";
import type {
  MediaRef,
  Platform,
  PlatformPublication,
  Publication,
  S3StorageConfig,
} from "../types.ts";

/**
 * Per-request publication engine scoped to a single user.
 */
export class PublishEngine {
  #githubToken: string;
  #userId: string;
  #store: Store;
  #encryptionSecret: string;

  constructor(opts: {
    githubToken: string;
    userId: string;
    store: Store;
    encryptionSecret: string;
  }) {
    this.#githubToken = opts.githubToken;
    this.#userId = opts.userId;
    this.#store = opts.store;
    this.#encryptionSecret = opts.encryptionSecret;
  }

  /** Process a gist: parse → upload media → publish to platforms. */
  async processGist(gistId: string, opts?: { defaultPlatforms?: Platform[] }): Promise<Publication> {
    const existing = await this.#store.getByGistId(this.#userId, gistId);
    if (existing) return this.#republishFailed(existing);

    const gist = await new GistClient({ token: this.#githubToken }).get(gistId);

    const mdFile = Object.values(gist.files).find(
      (f) => f.filename.endsWith(".md") || f.filename.endsWith(".markdown"),
    );
    if (!mdFile?.content) {
      throw new Error(`Gist ${gistId} has no markdown file with content`);
    }

    const content = parseGistContent(mdFile.content);
    const publishPlatforms = content.meta.platforms.length > 0
      ? content.meta.platforms
      : (opts?.defaultPlatforms ?? []);

    if (publishPlatforms.length === 0) {
      throw new Error("No publish platforms found in gist frontmatter and no default platforms configured");
    }

    content.meta.platforms = publishPlatforms;

    if (content.meta.draft) {
      const pub = this.#createPublication(gistId, content, []);
      pub.platforms = content.meta.platforms.map((p) => ({
        platform: p,
        status: "skipped" as const,
        retryCount: 0,
      }));
      await this.#store.save(this.#userId, pub);
      return pub;
    }

    // Upload media via user's S3-compatible storage
    const media = await this.#processMedia(gist, content.meta.media ?? []);
    const publication = this.#createPublication(gistId, content, media);

    // Build adapters from user's encrypted credentials
    for (const platformName of content.meta.platforms) {
      const platPub: PlatformPublication = {
        platform: platformName,
        status: "publishing",
        retryCount: 0,
      };

      const adapter = await this.#getAdapter(platformName);
      if (!adapter) {
        platPub.status = "skipped";
        platPub.error = `${platformName} is not configured`;
        publication.platforms.push(platPub);
        continue;
      }

      const issues = adapter.validate(content, media);
      if (issues.length > 0) {
        platPub.status = "failed";
        platPub.error = issues.join("; ");
        publication.platforms.push(platPub);
        continue;
      }

      try {
        const result = await adapter.publish(content, media);
        if (result.success) {
          platPub.status = "published";
          platPub.publishedAt = new Date().toISOString();
          platPub.platformPostId = result.postId;
          platPub.platformUrl = result.postUrl;
        } else {
          platPub.status = "failed";
          platPub.error = result.error;
        }
      } catch (err) {
        platPub.status = "failed";
        platPub.error = (err as Error).message;
      }

      publication.platforms.push(platPub);
    }

    publication.updatedAt = new Date().toISOString();
    await this.#store.save(this.#userId, publication);
    return publication;
  }

  /** Return platform status for the current user. */
  async platformStatus(): Promise<
    Array<{ platform: Platform; configured: boolean; displayName: string }>
  > {
    const { PLATFORM_SETUP } = await import("../platforms/setup.ts");
    const configured = await this.#store.listConfiguredPlatforms(this.#userId);
    return PLATFORM_SETUP.map((s) => ({
      platform: s.platform,
      displayName: s.displayName,
      configured: configured.includes(s.platform),
    }));
  }

  // ── Private helpers ────────────────────────────

  async #getAdapter(platform: Platform) {
    const blob = await this.#store.getCredentials(this.#userId, platform);
    if (!blob) return null;

    const json = await decrypt(blob, this.#encryptionSecret, this.#userId);
    const creds = JSON.parse(json);
    const adapter = buildAdapter(platform, creds);
    return adapter.isConfigured() ? adapter : null;
  }

  async #republishFailed(pub: Publication): Promise<Publication> {
    const failed = pub.platforms.filter((p) => p.status === "failed");
    if (failed.length === 0) return pub;

    for (const platPub of failed) {
      const adapter = await this.#getAdapter(platPub.platform);
      if (!adapter) continue;

      platPub.status = "publishing";
      platPub.retryCount++;

      try {
        const result = await adapter.publish(pub.content, pub.media);
        if (result.success) {
          platPub.status = "published";
          platPub.publishedAt = new Date().toISOString();
          platPub.platformPostId = result.postId;
          platPub.platformUrl = result.postUrl;
          platPub.error = undefined;
        } else {
          platPub.status = "failed";
          platPub.error = result.error;
        }
      } catch (err) {
        platPub.status = "failed";
        platPub.error = (err as Error).message;
      }
    }

    pub.updatedAt = new Date().toISOString();
    await this.#store.save(this.#userId, pub);
    return pub;
  }

  async #processMedia(
    gist: { id: string; files: Record<string, { raw_url: string; filename: string }> },
    mediaRefs: MediaRef[],
  ): Promise<MediaRef[]> {
    const s3 = await this.#getS3Client();
    if (!s3) return mediaRefs.filter((r) => !!r.url); // only keep pre-uploaded

    const gistClient = new GistClient({ token: this.#githubToken });
    const processed: MediaRef[] = [];

    for (const ref of mediaRefs) {
      if (ref.url) {
        processed.push(ref);
        continue;
      }

      const gistFile = Object.values(gist.files).find((f) => f.filename === ref.filename);
      if (!gistFile) {
        console.warn(`Media file not found: ${ref.filename}`);
        continue;
      }

      const data = await gistClient.downloadFile(gistFile.raw_url);
      const mimeType = guessMimeType(ref.filename);
      const key = `socials/${this.#userId}/${gist.id}/${ref.filename}`;

      try {
        const url = await s3.upload(key, data, mimeType);
        processed.push({ ...ref, url, mimeType, size: data.length });
      } catch (err) {
        console.error(`Failed to upload ${ref.filename}: ${(err as Error).message}`);
      }
    }

    return processed;
  }

  async #getS3Client(): Promise<S3Client | null> {
    const blob = await this.#store.getStorageConfig(this.#userId);
    if (!blob) return null;

    const json = await decrypt(blob, this.#encryptionSecret, this.#userId);
    const cfg = JSON.parse(json) as S3StorageConfig;
    return new S3Client(cfg);
  }

  #createPublication(
    gistId: string,
    content: ReturnType<typeof parseGistContent>,
    media: MediaRef[],
  ): Publication {
    return {
      id: crypto.randomUUID(),
      gistId,
      userId: this.#userId,
      content,
      media,
      platforms: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
