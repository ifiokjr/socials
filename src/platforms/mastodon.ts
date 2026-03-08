import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { MastodonCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

/**
 * Mastodon adapter using the Mastodon API.
 */
export class MastodonAdapter extends PlatformAdapter {
  readonly platform = "mastodon" as const;
  readonly displayName = "Mastodon";
  readonly maxTextLength = 500;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: MastodonCredentials;

  constructor(config: MastodonCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.instanceUrl && this.#config.accessToken);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.mastodon;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const text = this.buildPostText(content);
      let mediaIds: string[] = [];

      if (media.length > 0) {
        mediaIds = await this.#uploadMedia(media);
      }

      // deno-lint-ignore no-explicit-any
      const body: Record<string, any> = { status: text };
      if (mediaIds.length > 0) {
        body.media_ids = mediaIds;
      }

      const res = await fetch(`${this.#config.instanceUrl}/api/v1/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Mastodon API ${res.status}: ${await res.text()}`);
      const data = await res.json();

      return {
        success: true,
        platform: "mastodon",
        postId: data.id,
        postUrl: data.url,
      };
    } catch (err) {
      return {
        success: false,
        platform: "mastodon",
        error: (err as Error).message,
      };
    }
  }

  async #uploadMedia(media: MediaRef[]): Promise<string[]> {
    const ids: string[] = [];
    for (const m of media.slice(0, 4)) {
      if (!m.url) continue;

      const fileRes = await fetch(m.url);
      const blob = await fileRes.blob();

      const form = new FormData();
      form.append("file", blob, m.filename);
      if (m.alt) form.append("description", m.alt);

      const res = await fetch(`${this.#config.instanceUrl}/api/v2/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#config.accessToken}` },
        body: form,
      });

      if (!res.ok) throw new Error(`Mastodon media upload failed: ${await res.text()}`);
      const data = await res.json();
      ids.push(data.id);
    }
    return ids;
  }
}
