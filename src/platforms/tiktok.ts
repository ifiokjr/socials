import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { TikTokCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const TIKTOK_API = "https://open.tiktokapis.com/v2";

/**
 * TikTok adapter using the Content Posting API.
 * Only supports video content.
 */
export class TikTokAdapter extends PlatformAdapter {
  readonly platform = "tiktok" as const;
  readonly displayName = "TikTok";
  readonly maxTextLength = 2200;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = false;

  #config: TikTokCredentials;

  constructor(config: TikTokCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.accessToken && this.#config.openId);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.tiktok;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const video = media.find((m) => m.type === "video" && m.url);
      const images = media.filter((m) => m.type === "image" && m.url);
      const title = this.buildPostText(content);

      if (video?.url) {
        return await this.#publishVideo(title, video);
      } else if (images.length > 0) {
        return await this.#publishPhoto(title, images);
      }

      return {
        success: false,
        platform: "tiktok",
        error: "TikTok requires video or image content",
      };
    } catch (err) {
      return {
        success: false,
        platform: "tiktok",
        error: (err as Error).message,
      };
    }
  }

  async #publishVideo(title: string, video: MediaRef): Promise<PublishResult> {
    // Initialize video upload
    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#config.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: video.url,
        },
      }),
    });

    if (!initRes.ok) throw new Error(`TikTok init failed: ${await initRes.text()}`);
    const initData = await initRes.json();

    if (initData.error?.code !== "ok") {
      throw new Error(`TikTok error: ${initData.error?.message}`);
    }

    return {
      success: true,
      platform: "tiktok",
      postId: initData.data?.publish_id,
    };
  }

  async #publishPhoto(title: string, images: MediaRef[]): Promise<PublishResult> {
    const initRes = await fetch(`${TIKTOK_API}/post/publish/content/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#config.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: "PUBLIC_TO_EVERYONE",
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: 0,
          photo_images: images.map((img) => img.url),
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });

    if (!initRes.ok) throw new Error(`TikTok photo init failed: ${await initRes.text()}`);
    const initData = await initRes.json();

    if (initData.error?.code !== "ok") {
      throw new Error(`TikTok error: ${initData.error?.message}`);
    }

    return {
      success: true,
      platform: "tiktok",
      postId: initData.data?.publish_id,
    };
  }
}
