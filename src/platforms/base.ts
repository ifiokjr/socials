import type { MediaRef, ParsedContent, Platform, PublishResult } from "../types.ts";

/**
 * Base class for all platform adapters.
 * Each platform implements publish() and optionally validate().
 */
export abstract class PlatformAdapter {
  abstract readonly platform: Platform;
  abstract readonly displayName: string;
  abstract readonly maxTextLength: number;
  abstract readonly supportsImages: boolean;
  abstract readonly supportsVideo: boolean;
  abstract readonly supportsBlogLinks: boolean;

  /**
   * Publish content to this platform.
   */
  abstract publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult>;

  /**
   * Check if this adapter is configured (has required credentials).
   */
  abstract isConfigured(): boolean;

  /**
   * Validate that content is suitable for this platform.
   * Returns list of issues (empty = valid).
   */
  validate(content: ParsedContent, media: MediaRef[]): string[] {
    const issues: string[] = [];

    const text = this.formatText(content);
    if (text.length > this.maxTextLength) {
      issues.push(
        `Text exceeds ${this.platform} limit: ${text.length}/${this.maxTextLength} chars`,
      );
    }

    const images = media.filter((m) => m.type === "image");
    const videos = media.filter((m) => m.type === "video");

    if (images.length > 0 && !this.supportsImages) {
      issues.push(`${this.displayName} does not support image uploads`);
    }

    if (videos.length > 0 && !this.supportsVideo) {
      issues.push(`${this.displayName} does not support video uploads`);
    }

    return issues;
  }

  /**
   * Format content text for this platform.
   * Subclasses can override for platform-specific formatting.
   */
  formatText(content: ParsedContent): string {
    // Check for platform-specific override
    const override = content.meta.overrides?.[this.platform];
    if (override?.text) return override.text;

    return content.body;
  }

  /**
   * Format tags for this platform.
   */
  formatTags(tags: string[]): string {
    return tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  }

  /**
   * Build the full post text with tags appended.
   */
  buildPostText(content: ParsedContent): string {
    let text = this.formatText(content);
    const tags = content.meta.overrides?.[this.platform]?.tags ?? content.meta.tags;

    if (tags && tags.length > 0) {
      const tagStr = this.formatTags(tags);
      text = `${text}\n\n${tagStr}`;
    }

    return text;
  }
}
