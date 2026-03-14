import { PlatformAdapter } from "./base.ts";
import type { RedditCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const REDDIT_API = "https://oauth.reddit.com";
const REDDIT_AUTH = "https://www.reddit.com/api/v1/access_token";

/**
 * Reddit adapter using the Reddit API.
 * Posts to a specified subreddit.
 */
export class RedditAdapter extends PlatformAdapter {
  readonly platform = "reddit" as const;
  readonly displayName = "Reddit";
  readonly maxTextLength = 40000;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: RedditCredentials;
  #accessToken: string | null = null;
  #tokenExpiry = 0;

  constructor(config: RedditCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(
      this.#config.clientId &&
      this.#config.clientSecret &&
      this.#config.username &&
      this.#config.password &&
      this.#config.subreddit
    );
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.reddit;
    if (override?.text) return override.text;
    // Reddit supports markdown natively
    return content.body;
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const token = await this.#authenticate();
      const title = content.meta.overrides?.reddit?.title ?? content.meta.title;
      const text = this.buildPostText(content);
      const image = media.find((m) => m.type === "image" && m.url);

      let kind: string;
      // deno-lint-ignore no-explicit-any
      const data: Record<string, any> = {
        sr: this.#config.subreddit,
        title,
        api_type: "json",
        resubmit: true,
      };

      if (content.meta.type === "blog") {
        // Self post with markdown body
        kind = "self";
        data.text = text;
      } else if (image?.url) {
        // Link/image post
        kind = "link";
        data.url = image.url;
      } else {
        kind = "self";
        data.text = text;
      }

      const params = new URLSearchParams({ ...data, kind });

      const res = await fetch(`${REDDIT_API}/api/submit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "SocialPublisher/0.1.0",
        },
        body: params,
      });

      if (!res.ok) throw new Error(`Reddit API ${res.status}: ${await res.text()}`);
      const result = await res.json();

      const postUrl = result.json?.data?.url;
      const postId = result.json?.data?.id;

      return {
        success: true,
        platform: "reddit",
        postId,
        postUrl,
      };
    } catch (err) {
      return {
        success: false,
        platform: "reddit",
        error: (err as Error).message,
      };
    }
  }

  async #authenticate(): Promise<string> {
    if (this.#accessToken && Date.now() < this.#tokenExpiry) {
      return this.#accessToken;
    }

    const credentials = btoa(`${this.#config.clientId}:${this.#config.clientSecret}`);
    const res = await fetch(REDDIT_AUTH, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SocialPublisher/0.1.0",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: this.#config.username,
        password: this.#config.password,
      }),
    });

    if (!res.ok) throw new Error(`Reddit auth failed: ${await res.text()}`);
    const data = await res.json();
    this.#accessToken = data.access_token;
    this.#tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.#accessToken!;
  }
}
