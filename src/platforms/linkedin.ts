import { PlatformAdapter } from "./base.ts";
import { stripMarkdown } from "../gist/parser.ts";
import type { LinkedInCredentials } from "../types.ts";
import type { MediaRef, ParsedContent, PublishResult } from "../types.ts";

const API_BASE = "https://api.linkedin.com/v2";

/**
 * LinkedIn adapter using the LinkedIn API v2.
 */
export class LinkedInAdapter extends PlatformAdapter {
  readonly platform = "linkedin" as const;
  readonly displayName = "LinkedIn";
  readonly maxTextLength = 3000;
  readonly supportsImages = true;
  readonly supportsVideo = true;
  readonly supportsBlogLinks = true;

  #config: LinkedInCredentials;

  constructor(config: LinkedInCredentials) {
    super();
    this.#config = config;
  }

  isConfigured(): boolean {
    return !!(this.#config.accessToken && this.#config.personUrn);
  }

  override formatText(content: ParsedContent): string {
    const override = content.meta.overrides?.linkedin;
    if (override?.text) return override.text;
    return stripMarkdown(content.body);
  }

  async publish(content: ParsedContent, media: MediaRef[]): Promise<PublishResult> {
    try {
      const text = this.buildPostText(content);
      const images = media.filter((m) => m.type === "image" && m.url);

      // deno-lint-ignore no-explicit-any
      const shareContent: Record<string, any> = {
        author: this.#config.personUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: "NONE",
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      if (images.length > 0) {
        const mediaAssets = await this.#uploadImages(images);
        shareContent.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "IMAGE";
        shareContent.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets;
      }

      const res = await fetch(`${API_BASE}/ugcPosts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(shareContent),
      });

      if (!res.ok) throw new Error(`LinkedIn API ${res.status}: ${await res.text()}`);
      const data = await res.json();

      return {
        success: true,
        platform: "linkedin",
        postId: data.id,
        postUrl: `https://www.linkedin.com/feed/update/${data.id}`,
      };
    } catch (err) {
      return {
        success: false,
        platform: "linkedin",
        error: (err as Error).message,
      };
    }
  }

  async #uploadImages(
    images: MediaRef[],
  ): Promise<Array<{ status: string; media: string; title: { text: string } }>> {
    const results = [];

    for (const img of images) {
      // Register upload
      const registerRes = await fetch(`${API_BASE}/assets?action=registerUpload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: this.#config.personUrn,
            serviceRelationships: [{
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            }],
          },
        }),
      });

      if (!registerRes.ok) throw new Error(`LI register failed: ${await registerRes.text()}`);
      const registerData = await registerRes.json();

      const uploadUrl =
        registerData.value.uploadMechanism[
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
        ].uploadUrl;
      const asset = registerData.value.asset;

      // Download from B2 and upload to LinkedIn
      const fileRes = await fetch(img.url!);
      const fileData = new Uint8Array(await fileRes.arrayBuffer());

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.#config.accessToken}`,
          "Content-Type": img.mimeType ?? "image/jpeg",
        },
        body: fileData,
      });

      if (!uploadRes.ok) throw new Error(`LI upload failed: ${uploadRes.status}`);

      results.push({
        status: "READY",
        media: asset,
        title: { text: img.alt ?? img.filename },
      });
    }

    return results;
  }
}
