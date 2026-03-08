import { PlatformAdapter } from "./base.ts";
import { stripMarkdown, truncateText } from "../gist/parser.ts";
import type { ThreadsCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const GRAPH_API = "https://graph.threads.net/v1.0";

/**
 * Threads adapter using the Threads API (Meta).
 */
export class ThreadsAdapter extends PlatformAdapter {
  readonly platform = "threads" as const;
  readonly displayName = "Threads";
  readonly maxTextLength = 500;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: ThreadsCredentials;

  constructor(config: ThreadsCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.userId && this.#config.accessToken);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.threads;
    if (override?.text) return override.text;

    const plain = stripMarkdown(content.body);
    return truncateText(plain, this.maxTextLength);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const text = this.buildPostText(content);
      const image = media.find((m) => m.type === "image" && m.url);
      const video = media.find((m) => m.type === "video" && m.url);

      // deno-lint-ignore no-explicit-any
      const containerBody: Record<string, any> = {
        text,
        access_token: this.#config.accessToken,
      };

      if (video?.url) {
        containerBody.media_type = "VIDEO";
        containerBody.video_url = video.url;
      } else if (image?.url) {
        containerBody.media_type = "IMAGE";
        containerBody.image_url = image.url;
      } else {
        containerBody.media_type = "TEXT";
      }

      // Create container
      const containerRes = await fetch(
        `${GRAPH_API}/${this.#config.userId}/threads`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerBody),
        },
      );

      if (!containerRes.ok) {
        throw new Error(`Threads container failed: ${await containerRes.text()}`);
      }
      const containerData = await containerRes.json();

      // Wait for processing
      if (video?.url) {
        await this.#waitForContainer(containerData.id);
      }

      // Publish
      const publishRes = await fetch(
        `${GRAPH_API}/${this.#config.userId}/threads_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: containerData.id,
            access_token: this.#config.accessToken,
          }),
        },
      );

      if (!publishRes.ok) throw new Error(`Threads publish failed: ${await publishRes.text()}`);
      const data = await publishRes.json();

      return {
        success: true,
        platform: "threads",
        postId: data.id,
        postUrl: `https://threads.net/post/${data.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "threads",
        error: (err as Error).message,
      };
    }
  }

  async #waitForContainer(containerId: string, maxWait = 60_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const res = await fetch(
        `${GRAPH_API}/${containerId}?fields=status&access_token=${this.#config.accessToken}`,
      );
      const data = await res.json();
      if (data.status === "FINISHED") return;
      if (data.status === "ERROR") throw new Error(`Threads processing error`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timed out waiting for Threads processing");
  }
}
