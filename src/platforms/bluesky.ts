import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { BlueskyCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const BSKY_API = "https://bsky.social/xrpc";

/**
 * Bluesky adapter using the AT Protocol.
 */
export class BlueskyAdapter extends PlatformAdapter {
  readonly platform = "bluesky" as const;
  readonly displayName = "Bluesky";
  readonly maxTextLength = 300;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: BlueskyCredentials;
  #session: { did: string; accessJwt: string } | null = null;

  constructor(config: BlueskyCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.handle && this.#config.appPassword);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.bluesky;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      await this.#authenticate();

      const text = this.buildPostText(content);
      const images = media.filter((m) => m.type === "image" && m.url);

      // deno-lint-ignore no-explicit-any
      const record: Record<string, any> = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
      };

      // Extract facets (links, mentions, hashtags)
      const facets = this.#extractFacets(text);
      if (facets.length > 0) {
        record.facets = facets;
      }

      // Upload and embed images
      if (images.length > 0) {
        const blobs = await this.#uploadImages(images.slice(0, 4));
        record.embed = {
          $type: "app.bsky.embed.images",
          images: blobs.map((blob, i) => ({
            alt: images[i].alt ?? "",
            image: blob,
          })),
        };
      }

      const res = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#session!.accessJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: this.#session!.did,
          collection: "app.bsky.feed.post",
          record,
        }),
      });

      if (!res.ok) throw new Error(`Bluesky API ${res.status}: ${await res.text()}`);
      const data = await res.json();

      const rkey = data.uri.split("/").pop();
      return {
        success: true,
        platform: "bluesky",
        postId: data.uri,
        postUrl: `https://bsky.app/profile/${this.#config.handle}/post/${rkey}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "bluesky",
        error: (err as Error).message,
      };
    }
  }

  async #authenticate(): Promise<void> {
    if (this.#session) return;

    const res = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: this.#config.handle,
        password: this.#config.appPassword,
      }),
    });

    if (!res.ok) throw new Error(`Bluesky auth failed: ${await res.text()}`);
    this.#session = await res.json();
  }

  async #uploadImages(images: MediaRef[]): Promise<unknown[]> {
    const blobs = [];
    for (const img of images) {
      const fileRes = await fetch(img.url!);
      const data = new Uint8Array(await fileRes.arrayBuffer());

      const res = await fetch(`${BSKY_API}/com.atproto.repo.uploadBlob`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#session!.accessJwt}`,
          "Content-Type": img.mimeType ?? "image/jpeg",
        },
        body: data,
      });

      if (!res.ok) throw new Error(`Bluesky upload failed: ${await res.text()}`);
      const result = await res.json();
      blobs.push(result.blob);
    }
    return blobs;
  }

  // deno-lint-ignore no-explicit-any
  #extractFacets(text: string): any[] {
    // deno-lint-ignore no-explicit-any
    const facets: any[] = [];
    const encoder = new TextEncoder();

    // URLs
    const urlRe = /https?:\/\/[^\s)]+/g;
    let match;
    while ((match = urlRe.exec(text)) !== null) {
      const start = encoder.encode(text.slice(0, match.index)).length;
      const end = start + encoder.encode(match[0]).length;
      facets.push({
        index: { byteStart: start, byteEnd: end },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
      });
    }

    // Hashtags
    const tagRe = /#[a-zA-Z0-9_]+/g;
    while ((match = tagRe.exec(text)) !== null) {
      const start = encoder.encode(text.slice(0, match.index)).length;
      const end = start + encoder.encode(match[0]).length;
      facets.push({
        index: { byteStart: start, byteEnd: end },
        features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[0].slice(1) }],
      });
    }

    return facets;
  }
}
