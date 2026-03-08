/** Supported social platforms */
export type Platform =
  | "twitter"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "youtube"
  | "mastodon"
  | "bluesky"
  | "tiktok"
  | "pinterest"
  | "threads"
  | "reddit";

/** Content types that can be published */
export type ContentType = "post" | "blog" | "video";

/** Media types */
export type MediaType = "image" | "video";

/** Media reference in a gist */
export interface MediaRef {
  filename: string;
  type: MediaType;
  url?: string;
  fileId?: string;
  alt?: string;
  mimeType?: string;
  size?: number;
}

/** Frontmatter parsed from a gist markdown file */
export interface GistFrontmatter {
  title: string;
  type: ContentType;
  platforms: Platform[];
  tags?: string[];
  schedule?: string;
  media?: MediaRef[];
  description?: string;
  draft?: boolean;
  overrides?: Partial<Record<Platform, PlatformOverride>>;
}

/** Platform-specific content overrides */
export interface PlatformOverride {
  text?: string;
  title?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
}

/** Parsed content from a gist */
export interface ParsedContent {
  meta: GistFrontmatter;
  body: string;
  raw: string;
}

/** A GitHub Gist */
export interface Gist {
  id: string;
  description: string;
  public: boolean;
  files: Record<string, GistFile>;
  html_url: string;
  created_at: string;
  updated_at: string;
  owner?: {
    login: string;
    avatar_url: string;
  };
}

/** Summary used for recent gist selection in UI/API. */
export interface RecentGistPlatformStatus {
  platform: Platform;
  status: PublishStatus;
}

export interface RecentGist {
  id: string;
  description: string;
  htmlUrl: string;
  updatedAt: string;
  publishedPlatforms: Platform[];
  platformStatuses?: RecentGistPlatformStatus[];
  ownerLogin?: string;
  markdownFiles: string[];
}

/** A file within a gist */
export interface GistFile {
  filename: string;
  type: string;
  language: string | null;
  raw_url: string;
  size: number;
  content?: string;
}

/** Publication status for a single platform */
export type PublishStatus = "pending" | "publishing" | "published" | "failed" | "skipped";

/** Record of a publication to one platform */
export interface PlatformPublication {
  platform: Platform;
  status: PublishStatus;
  publishedAt?: string;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
  retryCount: number;
}

/** Full publication record for a gist (scoped to a user). */
export interface Publication {
  id: string;
  gistId: string;
  userId: string;
  content: ParsedContent;
  media: MediaRef[];
  platforms: PlatformPublication[];
  createdAt: string;
  updatedAt: string;
}

/** Result of a publish attempt */
export interface PublishResult {
  success: boolean;
  platform: Platform;
  postId?: string;
  postUrl?: string;
  error?: string;
}

// ── Per-user credential shapes ───────────────────
// These are the plaintext JSON objects that get encrypted before KV storage.

export interface TwitterCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface MetaCredentials {
  appId: string;
  appSecret: string;
  accessToken: string;
  pageId: string;
  instagramAccountId: string;
}

export interface LinkedInCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  personUrn: string;
}

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  channelId: string;
}

export interface MastodonCredentials {
  instanceUrl: string;
  accessToken: string;
}

export interface BlueskyCredentials {
  handle: string;
  appPassword: string;
}

export interface TikTokCredentials {
  accessToken: string;
  openId: string;
}

export interface PinterestCredentials {
  accessToken: string;
  boardId: string;
}

export interface ThreadsCredentials {
  userId: string;
  accessToken: string;
}

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  subreddit: string;
}

/** S3-compatible storage config that users bring themselves. */
export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Map platform name → its credential type. */
export type PlatformCredentialMap = {
  twitter: TwitterCredentials;
  facebook: MetaCredentials;
  instagram: MetaCredentials;
  linkedin: LinkedInCredentials;
  youtube: YouTubeCredentials;
  mastodon: MastodonCredentials;
  bluesky: BlueskyCredentials;
  tiktok: TikTokCredentials;
  pinterest: PinterestCredentials;
  threads: ThreadsCredentials;
  reddit: RedditCredentials;
};

/** Metadata describing what fields a platform needs. */
export interface PlatformSetupField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  helpUrl?: string;
}

/** Per-user preferences stored in KV. */
export interface UserPreferences {
  defaultPlatforms: Platform[];
}

/** B2 / S3 types (still used by the storage client) */
export interface B2AuthResponse {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  recommendedPartSize: number;
  absoluteMinimumPartSize: number;
}

export interface B2UploadUrl {
  bucketId: string;
  uploadUrl: string;
  authorizationToken: string;
}

export interface B2FileInfo {
  fileId: string;
  fileName: string;
  contentLength: number;
  contentType: string;
  contentSha1: string;
}
