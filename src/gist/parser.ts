import { parse as parseYaml } from "@std/yaml";
import type { GistFrontmatter, ParsedContent } from "../types.ts";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Parse a gist markdown file into frontmatter and body.
 * Expects YAML frontmatter delimited by `---`.
 */
export function parseGistContent(raw: string): ParsedContent {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new GistParseError("Content does not contain valid YAML frontmatter delimited by ---");
  }

  const [, yamlStr, body] = match;
  let parsed: Record<string, unknown>;

  try {
    parsed = parseYaml(yamlStr) as Record<string, unknown>;
  } catch (err) {
    throw new GistParseError(`Invalid YAML frontmatter: ${(err as Error).message}`);
  }

  const meta = validateFrontmatter(parsed);

  return {
    meta,
    body: body.trim(),
    raw,
  };
}

const VALID_TYPES = new Set(["post", "blog", "video"]);
const VALID_PLATFORMS = new Set([
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "mastodon",
  "bluesky",
  "tiktok",
  "pinterest",
  "threads",
  "reddit",
]);
const VALID_MEDIA_TYPES = new Set(["image", "video"]);

function validateFrontmatter(data: Record<string, unknown>): GistFrontmatter {
  if (!data.title || typeof data.title !== "string") {
    throw new GistParseError("Frontmatter must include a 'title' string");
  }

  if (!data.type || typeof data.type !== "string" || !VALID_TYPES.has(data.type)) {
    throw new GistParseError(`Frontmatter 'type' must be one of: ${[...VALID_TYPES].join(", ")}`);
  }

  if (!Array.isArray(data.platforms) || data.platforms.length === 0) {
    throw new GistParseError("Frontmatter must include a non-empty 'platforms' array");
  }

  for (const p of data.platforms) {
    if (typeof p !== "string" || !VALID_PLATFORMS.has(p)) {
      throw new GistParseError(
        `Invalid platform '${p}'. Must be one of: ${[...VALID_PLATFORMS].join(", ")}`,
      );
    }
  }

  const result: GistFrontmatter = {
    title: data.title,
    type: data.type as GistFrontmatter["type"],
    platforms: data.platforms as GistFrontmatter["platforms"],
  };

  if (data.tags) {
    if (!Array.isArray(data.tags) || !data.tags.every((t: unknown) => typeof t === "string")) {
      throw new GistParseError("Frontmatter 'tags' must be an array of strings");
    }
    result.tags = data.tags;
  }

  if (data.schedule) {
    if (typeof data.schedule !== "string" || isNaN(Date.parse(data.schedule))) {
      throw new GistParseError("Frontmatter 'schedule' must be a valid ISO 8601 date string");
    }
    result.schedule = data.schedule;
  }

  if (data.description) {
    if (typeof data.description !== "string") {
      throw new GistParseError("Frontmatter 'description' must be a string");
    }
    result.description = data.description;
  }

  if (data.draft !== undefined) {
    if (typeof data.draft !== "boolean") {
      throw new GistParseError("Frontmatter 'draft' must be a boolean");
    }
    result.draft = data.draft;
  }

  if (data.media) {
    if (!Array.isArray(data.media)) {
      throw new GistParseError("Frontmatter 'media' must be an array");
    }
    result.media = data.media.map((m: Record<string, unknown>, i: number) => {
      if (!m.filename || typeof m.filename !== "string") {
        throw new GistParseError(`media[${i}] must have a 'filename' string`);
      }
      if (!m.type || typeof m.type !== "string" || !VALID_MEDIA_TYPES.has(m.type)) {
        throw new GistParseError(`media[${i}].type must be 'image' or 'video'`);
      }
      return {
        filename: m.filename,
        type: m.type as "image" | "video",
        alt: typeof m.alt === "string" ? m.alt : undefined,
      };
    });
  }

  if (data.overrides && typeof data.overrides === "object") {
    result.overrides = data.overrides as GistFrontmatter["overrides"];
  }

  return result;
}

/** Extract hashtags from tags array, formatted for social platforms */
export function tagsToHashtags(tags: string[]): string {
  return tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
}

/** Truncate text to fit platform character limits */
export function truncateText(text: string, maxLength: number, suffix = "…"): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/** Strip markdown formatting for plain-text platforms */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // code blocks (before inline code)
    .replace(/#{1,6}\s+/g, "") // headings
    .replace(/!\[.*?\]\(.*?\)/g, "") // images (before links)
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)") // links
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/__(.+?)__/g, "$1") // bold alt
    .replace(/_(.+?)_/g, "$1") // italic alt
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/^[>\-*+]\s+/gm, "") // blockquotes, lists
    .replace(/^\d+\.\s+/gm, "") // ordered lists
    .replace(/\n{3,}/g, "\n\n") // excess newlines
    .trim();
}

export class GistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GistParseError";
  }
}
