import type { Platform, PlatformSetupField } from "../types.ts";

/** Human-readable info + required fields for each platform's setup wizard. */
export interface PlatformSetupInfo {
  platform: Platform;
  displayName: string;
  icon: string;
  description: string;
  docsUrl: string;
  fields: PlatformSetupField[];
}

export const PLATFORM_SETUP: PlatformSetupInfo[] = [
  {
    platform: "twitter",
    displayName: "X (Twitter)",
    icon: "𝕏",
    description: "Post tweets with images and video. Requires a Twitter Developer account.",
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-1-0a",
    fields: [
      { key: "apiKey", label: "API Key", type: "text", placeholder: "Consumer API key" },
      { key: "apiSecret", label: "API Secret", type: "password", placeholder: "Consumer secret" },
      { key: "accessToken", label: "Access Token", type: "text" },
      { key: "accessTokenSecret", label: "Access Token Secret", type: "password" },
    ],
  },
  {
    platform: "facebook",
    displayName: "Facebook",
    icon: "📘",
    description: "Post to a Facebook Page. Requires a Meta developer app with page permissions.",
    docsUrl: "https://developers.facebook.com/docs/pages-api/",
    fields: [
      { key: "appId", label: "App ID", type: "text" },
      { key: "appSecret", label: "App Secret", type: "password" },
      { key: "accessToken", label: "Page Access Token", type: "password" },
      { key: "pageId", label: "Page ID", type: "text" },
      {
        key: "instagramAccountId",
        label: "Instagram Business Account ID",
        type: "text",
        placeholder: "Optional — needed for Instagram",
      },
    ],
  },
  {
    platform: "instagram",
    displayName: "Instagram",
    icon: "📸",
    description:
      "Post images, carousels, and Reels. Uses the same Meta app as Facebook — fill in the Instagram Business Account ID in Facebook setup.",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/",
    fields: [
      { key: "appId", label: "App ID", type: "text" },
      { key: "appSecret", label: "App Secret", type: "password" },
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "pageId", label: "Facebook Page ID", type: "text" },
      { key: "instagramAccountId", label: "Instagram Business Account ID", type: "text" },
    ],
  },
  {
    platform: "linkedin",
    displayName: "LinkedIn",
    icon: "💼",
    description: "Share posts and articles to your LinkedIn profile.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/",
    fields: [
      { key: "clientId", label: "Client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", type: "password" },
      { key: "accessToken", label: "Access Token", type: "password" },
      {
        key: "personUrn",
        label: "Person URN",
        type: "text",
        placeholder: "urn:li:person:XXXXXXXXX",
      },
    ],
  },
  {
    platform: "youtube",
    displayName: "YouTube",
    icon: "▶️",
    description: "Upload videos to your YouTube channel.",
    docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
    fields: [
      { key: "clientId", label: "Google Client ID", type: "text" },
      { key: "clientSecret", label: "Google Client Secret", type: "password" },
      { key: "refreshToken", label: "Refresh Token", type: "password" },
      { key: "channelId", label: "Channel ID", type: "text" },
    ],
  },
  {
    platform: "mastodon",
    displayName: "Mastodon",
    icon: "🐘",
    description: "Post to any Mastodon instance.",
    docsUrl: "https://docs.joinmastodon.org/client/token/",
    fields: [
      {
        key: "instanceUrl",
        label: "Instance URL",
        type: "url",
        placeholder: "https://mastodon.social",
      },
      { key: "accessToken", label: "Access Token", type: "password" },
    ],
  },
  {
    platform: "bluesky",
    displayName: "Bluesky",
    icon: "🦋",
    description: "Post to Bluesky via the AT Protocol.",
    docsUrl: "https://bsky.app/settings/app-passwords",
    fields: [
      {
        key: "handle",
        label: "Handle",
        type: "text",
        placeholder: "your-name.bsky.social",
      },
      { key: "appPassword", label: "App Password", type: "password" },
    ],
  },
  {
    platform: "tiktok",
    displayName: "TikTok",
    icon: "🎵",
    description: "Publish videos and photo carousels to TikTok.",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "openId", label: "Open ID", type: "text" },
    ],
  },
  {
    platform: "pinterest",
    displayName: "Pinterest",
    icon: "📌",
    description: "Create Pins on a Pinterest board.",
    docsUrl: "https://developers.pinterest.com/docs/api/v5/",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "boardId", label: "Board ID", type: "text" },
    ],
  },
  {
    platform: "threads",
    displayName: "Threads",
    icon: "🧵",
    description: "Post to Threads (Meta).",
    docsUrl: "https://developers.facebook.com/docs/threads/",
    fields: [
      { key: "userId", label: "Threads User ID", type: "text" },
      { key: "accessToken", label: "Access Token", type: "password" },
    ],
  },
  {
    platform: "reddit",
    displayName: "Reddit",
    icon: "🤖",
    description: "Submit posts to a subreddit.",
    docsUrl: "https://www.reddit.com/dev/api/",
    fields: [
      { key: "clientId", label: "Client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", type: "password" },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
      { key: "subreddit", label: "Subreddit", type: "text", placeholder: "e.g. webdev" },
    ],
  },
];

/** Look up setup info for one platform. */
export function getSetupInfo(platform: Platform): PlatformSetupInfo | undefined {
  return PLATFORM_SETUP.find((s) => s.platform === platform);
}
