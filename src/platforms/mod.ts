import type { Platform } from "../types.ts";
import type { PlatformAdapter } from "./base.ts";
import { BlueskyAdapter } from "./bluesky.ts";
import { FacebookAdapter } from "./facebook.ts";
import { InstagramAdapter } from "./instagram.ts";
import { LinkedInAdapter } from "./linkedin.ts";
import { MastodonAdapter } from "./mastodon.ts";
import { PinterestAdapter } from "./pinterest.ts";
import { RedditAdapter } from "./reddit.ts";
import { ThreadsAdapter } from "./threads.ts";
import { TikTokAdapter } from "./tiktok.ts";
import { TwitterAdapter } from "./twitter.ts";
import { YouTubeAdapter } from "./youtube.ts";
export { PLATFORM_SETUP, getSetupInfo } from "./setup.ts";

export {
  BlueskyAdapter,
  FacebookAdapter,
  InstagramAdapter,
  LinkedInAdapter,
  MastodonAdapter,
  PinterestAdapter,
  RedditAdapter,
  ThreadsAdapter,
  TikTokAdapter,
  TwitterAdapter,
  YouTubeAdapter,
};

export type { PlatformAdapter };

/**
 * Build a single adapter from a decrypted credential record.
 * `creds` is the raw JSON object the user stored during setup.
 */
export function buildAdapter(
  platform: Platform,
  // deno-lint-ignore no-explicit-any
  creds: any,
): PlatformAdapter {
  switch (platform) {
    case "twitter":
      return new TwitterAdapter(creds);
    case "facebook":
      return new FacebookAdapter(creds);
    case "instagram":
      return new InstagramAdapter(creds);
    case "linkedin":
      return new LinkedInAdapter(creds);
    case "youtube":
      return new YouTubeAdapter(creds);
    case "mastodon":
      return new MastodonAdapter(creds);
    case "bluesky":
      return new BlueskyAdapter(creds);
    case "tiktok":
      return new TikTokAdapter(creds);
    case "pinterest":
      return new PinterestAdapter(creds);
    case "threads":
      return new ThreadsAdapter(creds);
    case "reddit":
      return new RedditAdapter(creds);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/** All supported platform identifiers. */
export const ALL_PLATFORMS: Platform[] = [
  "twitter",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "mastodon",
  "bluesky",
  "tiktok",
  "pinterest",
  "threads",
  "reddit",
];

export const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  twitter: "X (Twitter)",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  threads: "Threads",
  reddit: "Reddit",
};
