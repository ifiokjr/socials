import { PlatformAdapter } from "./base.ts";
import { stripMarkdown } from "../gist/parser.ts";
import type { MetaCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Facebook Page adapter using the Graph API.
 */
export class FacebookAdapter extends PlatformAdapter {
  readonly platform = "facebook" as const;
  readonly displayName = "Facebook";
  readonly maxTextLength = 63206;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: MetaCredentials;

  constructor(config: MetaCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.accessToken && this.#config.pageId);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.facebook;
    if (override?.text) return override.text;
    return stripMarkdown(content.body);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const text = this.buildPostText(content);
      const images = media.filter((m) => m.type === "image" && m.url);
      const videos = media.filter((m) => m.type === "video" && m.url);

      let result: { id: string };

      if (videos.length > 0) {
        result = await this.#publishVideo(text, videos[0]);
      } else if (images.length > 0) {
        result = await this.#publishWithPhotos(text, images);
      } else {
        result = await this.#publishText(text);
      }

      return {
        success: true,
        platform: "facebook",
        postId: result.id,
        postUrl: `https://facebook.com/${result.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "facebook",
        error: (err as Error).message,
      };
    }
  }

  async #publishText(message: string): Promise<{ id: string }> {
    const res = await fetch(`${GRAPH_API}/${this.#config.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async #publishWithPhotos(message: string, photos: MediaRef[]): Promise<{ id: string }> {
    // Upload each photo first
    const photoIds: string[] = [];
    for (const photo of photos.slice(0, 10)) {
      const res = await fetch(`${GRAPH_API}/${this.#config.pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: photo.url,
          published: false,
          access_token: this.#config.accessToken,
        }),
      });
      if (!res.ok) throw new Error(`Photo upload failed: ${await res.text()}`);
      const data = await res.json();
      photoIds.push(data.id);
    }

    // Create post with attached photos
    const attachedMedia = photoIds.map((id) => ({ media_fbid: id }));
    const res = await fetch(`${GRAPH_API}/${this.#config.pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        attached_media: attachedMedia,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`Facebook post failed: ${await res.text()}`);
    return res.json();
  }

  async #publishVideo(description: string, video: MediaRef): Promise<{ id: string }> {
    const res = await fetch(`${GRAPH_API}/${this.#config.pageId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: video.url,
        description,
        access_token: this.#config.accessToken,
      }),
    });

    if (!res.ok) throw new Error(`Video upload failed: ${await res.text()}`);
    return res.json();
  }
}
