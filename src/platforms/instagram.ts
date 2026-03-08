import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { MetaCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Instagram adapter using the Instagram Graph API (via Meta).
 * Requires a Business or Creator account linked to a Facebook Page.
 */
export class InstagramAdapter extends PlatformAdapter {
  readonly platform = "instagram" as const;
  readonly displayName = "Instagram";
  readonly maxTextLength = 2200;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = false; // No clickable links in captions

  #config: MetaCredentials;

  constructor(config: MetaCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.accessToken && this.#config.instagramAccountId);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.instagram;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  override validate(content: ParsedContent, media: MediaRef[]): string[] {
    const issues = super.validate(content, media);

    // Instagram requires at least one media item
    if (media.length === 0) {
      issues.push("Instagram requires at least one image or video");
    }

    return issues;
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const caption = this.buildPostText(content);
      const images = media.filter((m) => m.type === "image" && m.url);
      const videos = media.filter((m) => m.type === "video" && m.url);

      let containerId: string;

      if (images.length > 1) {
        // Carousel post
        containerId = await this.#createCarousel(caption, images);
      } else if (videos.length > 0) {
        // Reels/video
        containerId = await this.#createVideoContainer(caption, videos[0]);
      } else if (images.length === 1) {
        // Single image
        containerId = await this.#createImageContainer(caption, images[0]);
      } else {
        return {
          success: false,
          platform: "instagram",
          error: "Instagram requires at least one image or video",
        };
      }

      // Wait for container to be ready, then publish
      await this.#waitForContainer(containerId);
      const result = await this.#publishContainer(containerId);

      return {
        success: true,
        platform: "instagram",
        postId: result.id,
        postUrl: `https://instagram.com/p/${result.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "instagram",
        error: (err as Error).message,
      };
    }
  }

  async #createImageContainer(caption: string, image: MediaRef): Promise<string> {
    const res = await fetch(`${GRAPH_API}/${this.#config.instagramAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: image.url,
        caption,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`IG image container failed: ${await res.text()}`);
    const data = await res.json();
    return data.id;
  }

  async #createVideoContainer(caption: string, video: MediaRef): Promise<string> {
    const res = await fetch(`${GRAPH_API}/${this.#config.instagramAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_url: video.url,
        caption,
        media_type: "REELS",
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`IG video container failed: ${await res.text()}`);
    const data = await res.json();
    return data.id;
  }

  async #createCarousel(caption: string, images: MediaRef[]): Promise<string> {
    // Create child containers
    const childIds: string[] = [];
    for (const img of images.slice(0, 10)) {
      const res = await fetch(`${GRAPH_API}/${this.#config.instagramAccountId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: img.url,
          is_carousel_item: true,
          access_token: this.#config.accessToken,
        }),
      });
      if (!res.ok) throw new Error(`IG carousel item failed: ${await res.text()}`);
      const data = await res.json();
      childIds.push(data.id);
    }

    // Create carousel container
    const res = await fetch(`${GRAPH_API}/${this.#config.instagramAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption,
        media_type: "CAROUSEL",
        children: childIds,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`IG carousel container failed: ${await res.text()}`);
    const data = await res.json();
    return data.id;
  }

  async #waitForContainer(containerId: string, maxWait = 60_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const res = await fetch(
        `${GRAPH_API}/${containerId}?fields=status_code&access_token=${this.#config.accessToken}`,
      );
      const data = await res.json();

      if (data.status_code === "FINISHED") return;
      if (data.status_code === "ERROR") {
        throw new Error(`IG media container error: ${JSON.stringify(data)}`);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timed out waiting for IG media container");
  }

  async #publishContainer(containerId: string): Promise<{ id: string }> {
    const res = await fetch(`${GRAPH_API}/${this.#config.instagramAccountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`IG publish failed: ${await res.text()}`);
    return res.json();
  }
}
