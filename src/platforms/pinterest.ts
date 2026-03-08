import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { PinterestCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const API_BASE = "https://api.pinterest.com/v5";

/**
 * Pinterest adapter using the Pinterest API v5.
 * Creates Pins with images.
 */
export class PinterestAdapter extends PlatformAdapter {
  readonly platform = "pinterest" as const;
  readonly displayName = "Pinterest";
  readonly maxTextLength = 500;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: PinterestCredentials;

  constructor(config: PinterestCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.accessToken && this.#config.boardId);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.pinterest;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  override validate(content: ParsedContent, media: MediaRef[]): string[] {
    const issues = super.validate(content, media);
    const images = media.filter((m) => m.type === "image");
    if (images.length === 0) {
      issues.push("Pinterest requires at least one image");
    }
    return issues;
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const image = media.find((m) => m.type === "image" && m.url);
      if (!image?.url) {
        return {
          success: false,
          platform: "pinterest",
          error: "Pinterest requires at least one image",
        };
      }

      const description = this.buildPostText(content);
      const title = content.meta.overrides?.pinterest?.title ?? content.meta.title;

      const res = await fetch(`${API_BASE}/pins`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          board_id: this.#config.boardId,
          title,
          description,
          media_source: {
            source_type: "image_url",
            url: image.url,
          },
          alt_text: image.alt ?? title,
        }),
      });

      if (!res.ok) throw new Error(`Pinterest API ${res.status}: ${await res.text()}`);
      const data = await res.json();

      return {
        success: true,
        platform: "pinterest",
        postId: data.id,
        postUrl: `https://pinterest.com/pin/${data.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "pinterest",
        error: (err as Error).message,
      };
    }
  }
}
