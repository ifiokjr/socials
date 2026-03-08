import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { TwitterCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";
import { encodeHex } from "@std/encoding/hex";

/**
 * X (Twitter) API v2 adapter.
 * Uses OAuth 1.0a for authentication.
 */
export class TwitterAdapter extends PlatformAdapter {
  readonly platform = "twitter" as const;
  readonly displayName = "X (Twitter)";
  readonly maxTextLength = 280;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: TwitterCredentials;

  constructor(config: TwitterCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(
      this.#config.apiKey &&
      this.#config.apiSecret &&
      this.#config.accessToken &&
      this.#config.accessTokenSecret
    );
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.twitter;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      let mediaIds: string[] = [];

      // Upload media first if present
      if (media.length > 0) {
        mediaIds = await this.#uploadMedia(media);
      }

      const text = this.buildPostText(content);
      const tweetBody: Record<string, unknown> = { text };

      if (mediaIds.length > 0) {
        tweetBody.media = { media_ids: mediaIds };
      }

      const response = await this.#oauthRequest(
        "POST",
        "https://api.twitter.com/2/tweets",
        tweetBody,
      );

      return {
        success: true,
        platform: "twitter",
        postId: response.data.id,
        postUrl: `https://x.com/i/status/${response.data.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "twitter",
        error: (err as Error).message,
      };
    }
  }

  async #uploadMedia(media: MediaRef[]): Promise<string[]> {
    const ids: string[] = [];
    for (const m of media.slice(0, 4)) {
      if (!m.url) continue;

      // Download from B2
      const res = await fetch(m.url);
      const data = new Uint8Array(await res.arrayBuffer());

      // Upload to Twitter media endpoint
      const form = new FormData();
      form.append("media_data", btoa(String.fromCharCode(...data)));
      form.append("media_category", m.type === "video" ? "tweet_video" : "tweet_image");

      const uploadRes = await this.#oauthRequest(
        "POST",
        "https://upload.twitter.com/1.1/media/upload.json",
        form,
        true,
      );

      ids.push(uploadRes.media_id_string);
    }
    return ids;
  }

  // deno-lint-ignore no-explicit-any
  async #oauthRequest(method: string, url: string, body?: unknown, isForm = false): Promise<any> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.#config.apiKey,
      oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: this.#config.accessToken,
      oauth_version: "1.0",
    };

    const signature = await this.#generateSignature(method, url, oauthParams);
    oauthParams.oauth_signature = signature;

    const authHeader = "OAuth " +
      Object.entries(oauthParams)
        .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
        .join(", ");

    const headers: HeadersInit = { Authorization: authHeader };
    let reqBody: BodyInit | undefined;

    if (isForm) {
      reqBody = body as FormData;
    } else if (body) {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: reqBody });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twitter API ${res.status}: ${text}`);
    }
    return res.json();
  }

  async #generateSignature(
    method: string,
    url: string,
    params: Record<string, string>,
  ): Promise<string> {
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey = `${encodeURIComponent(this.#config.apiSecret)}&${
      encodeURIComponent(this.#config.accessTokenSecret)
    }`;

    const keyData = new TextEncoder().encode(signingKey);
    const msgData = new TextEncoder().encode(baseString);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );

    const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
}
