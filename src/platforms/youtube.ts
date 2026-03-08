import { PlatformAdapter } from "./base.ts";
import { stripMarkdown } from "../gist/parser.ts";
import type { YouTubeCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const API_BASE = "https://www.googleapis.com";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * YouTube adapter using the YouTube Data API v3.
 * Only publishes video content.
 */
export class YouTubeAdapter extends PlatformAdapter {
  readonly platform = "youtube" as const;
  readonly displayName = "YouTube";
  readonly maxTextLength = 5000; // Description limit
  readonly supportsImages = false;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: YouTubeCredentials;
  #accessToken: string | null = null;
  #tokenExpiry = 0;

  constructor(config: YouTubeCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.clientId && this.#config.clientSecret && this.#config.refreshToken);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.youtube;
    if (override?.text) return override.text;
    return stripMarkdown(content.body);
  }

  override validate(content: ParsedContent, media: MediaRef[]): string[] {
    const issues = super.validate(content, media);

    if (content.meta.type !== "video") {
      issues.push("YouTube only supports video content");
    }

    const videos = media.filter((m) => m.type === "video");
    if (videos.length === 0) {
      issues.push("YouTube requires a video file");
    }

    return issues;
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const video = media.find((m) => m.type === "video" && m.url);
      if (!video?.url) {
        return {
          success: false,
          platform: "youtube",
          error: "No video file provided",
        };
      }

      const accessToken = await this.#getAccessToken();
      const description = this.buildPostText(content);
      const title = content.meta.overrides?.youtube?.title ?? content.meta.title;
      const tags = content.meta.overrides?.youtube?.tags ?? content.meta.tags ?? [];

      // Download video from B2
      const videoRes = await fetch(video.url);
      const videoData = new Uint8Array(await videoRes.arrayBuffer());

      // Initiate resumable upload
      const initRes = await fetch(
        `${API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(videoData.length),
            "X-Upload-Content-Type": video.mimeType ?? "video/mp4",
          },
          body: JSON.stringify({
            snippet: {
              title,
              description,
              tags,
              categoryId: "22", // People & Blogs
            },
            status: {
              privacyStatus: "public",
              selfDeclaredMadeForKids: false,
            },
          }),
        },
      );

      if (!initRes.ok) throw new Error(`YT init failed: ${await initRes.text()}`);
      const uploadLocation = initRes.headers.get("Location");
      if (!uploadLocation) throw new Error("No upload location returned");

      // Upload the video bytes
      const uploadRes = await fetch(uploadLocation, {
        method: "PUT",
        headers: {
          "Content-Type": video.mimeType ?? "video/mp4",
          "Content-Length": String(videoData.length),
        },
        body: videoData,
      });

      if (!uploadRes.ok) throw new Error(`YT upload failed: ${await uploadRes.text()}`);
      const result = await uploadRes.json();

      return {
        success: true,
        platform: "youtube",
        postId: result.id,
        postUrl: `https://youtube.com/watch?v=${result.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "youtube",
        error: (err as Error).message,
      };
    }
  }

  async #getAccessToken(): Promise<string> {
    if (this.#accessToken && Date.now() < this.#tokenExpiry) {
      return this.#accessToken;
    }

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        refresh_token: this.#config.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) throw new Error(`Google OAuth failed: ${await res.text()}`);
    const data = await res.json();
    this.#accessToken = data.access_token;
    this.#tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.#accessToken!;
  }
}
