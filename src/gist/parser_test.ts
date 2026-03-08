import { assertEquals, assertThrows } from "@std/assert";
import {
  GistParseError,
  parseGistContent,
  stripMarkdown,
  tagsToHashtags,
  truncateText,
} from "./parser.ts";

Deno.test("parseGistContent - parses valid frontmatter and body", () => {
  const raw = `---
title: My First Post
type: post
platforms: [twitter, mastodon, bluesky]
tags: [tech, deno]
---

Hello world! This is my first cross-posted message.`;

  const result = parseGistContent(raw);

  assertEquals(result.meta.title, "My First Post");
  assertEquals(result.meta.type, "post");
  assertEquals(result.meta.platforms, ["twitter", "mastodon", "bluesky"]);
  assertEquals(result.meta.tags, ["tech", "deno"]);
  assertEquals(result.body, "Hello world! This is my first cross-posted message.");
  assertEquals(result.raw, raw);
});

Deno.test("parseGistContent - parses blog with media", () => {
  const raw = `---
title: My Blog Post
type: blog
platforms: [linkedin, facebook, reddit]
description: A blog post about Deno
media:
  - filename: hero.jpg
    type: image
    alt: Hero image
  - filename: demo.mp4
    type: video
---

# Introduction

This is a detailed blog post about building things with Deno.`;

  const result = parseGistContent(raw);

  assertEquals(result.meta.title, "My Blog Post");
  assertEquals(result.meta.type, "blog");
  assertEquals(result.meta.description, "A blog post about Deno");
  assertEquals(result.meta.media?.length, 2);
  assertEquals(result.meta.media?.[0].filename, "hero.jpg");
  assertEquals(result.meta.media?.[0].type, "image");
  assertEquals(result.meta.media?.[0].alt, "Hero image");
  assertEquals(result.meta.media?.[1].filename, "demo.mp4");
  assertEquals(result.meta.media?.[1].type, "video");
});

Deno.test("parseGistContent - parses video content", () => {
  const raw = `---
title: My Tutorial Video
type: video
platforms: [youtube, tiktok]
tags: [tutorial, coding]
media:
  - filename: tutorial.mp4
    type: video
---

In this video I walk through building a web app with Deno.`;

  const result = parseGistContent(raw);
  assertEquals(result.meta.type, "video");
  assertEquals(result.meta.platforms, ["youtube", "tiktok"]);
});

Deno.test("parseGistContent - parses scheduled post", () => {
  const raw = `---
title: Scheduled Post
type: post
platforms: [twitter]
schedule: "2026-04-01T12:00:00Z"
---

This will be posted later.`;

  const result = parseGistContent(raw);
  assertEquals(result.meta.schedule, "2026-04-01T12:00:00Z");
});

Deno.test("parseGistContent - parses draft", () => {
  const raw = `---
title: Draft Post
type: post
platforms: [twitter]
draft: true
---

Work in progress.`;

  const result = parseGistContent(raw);
  assertEquals(result.meta.draft, true);
});

Deno.test("parseGistContent - parses platform overrides", () => {
  const raw = `---
title: Multi-platform Post
type: post
platforms: [twitter, linkedin]
overrides:
  twitter:
    text: "Short tweet version"
  linkedin:
    text: "Longer LinkedIn version with more professional context."
---

Default content for other platforms.`;

  const result = parseGistContent(raw);
  assertEquals(result.meta.overrides?.twitter?.text, "Short tweet version");
  assertEquals(
    result.meta.overrides?.linkedin?.text,
    "Longer LinkedIn version with more professional context.",
  );
});

Deno.test("parseGistContent - throws on missing frontmatter", () => {
  assertThrows(
    () => parseGistContent("Just plain text without frontmatter."),
    GistParseError,
    "does not contain valid YAML frontmatter",
  );
});

Deno.test("parseGistContent - throws on missing title", () => {
  const raw = `---
type: post
platforms: [twitter]
---
Content`;
  assertThrows(() => parseGistContent(raw), GistParseError, "'title' string");
});

Deno.test("parseGistContent - throws on invalid type", () => {
  const raw = `---
title: Test
type: story
platforms: [twitter]
---
Content`;
  assertThrows(() => parseGistContent(raw), GistParseError, "'type' must be one of");
});

Deno.test("parseGistContent - allows empty platforms for engine defaults", () => {
  const raw = `---
title: Test
type: post
platforms: []
---
Content`;
  const result = parseGistContent(raw);
  assertEquals(result.meta.platforms, []);
});

Deno.test("parseGistContent - allows missing platforms field", () => {
  const raw = `---
title: Test
type: post
---
Content`;
  const result = parseGistContent(raw);
  assertEquals(result.meta.platforms, []);
});

Deno.test("parseGistContent - throws on invalid platform", () => {
  const raw = `---
title: Test
type: post
platforms: [twitter, myspace]
---
Content`;
  assertThrows(() => parseGistContent(raw), GistParseError, "Invalid platform 'myspace'");
});

Deno.test("parseGistContent - throws on invalid media type", () => {
  const raw = `---
title: Test
type: post
platforms: [twitter]
media:
  - filename: doc.pdf
    type: document
---
Content`;
  assertThrows(() => parseGistContent(raw), GistParseError, "must be 'image' or 'video'");
});

Deno.test("parseGistContent - throws on invalid schedule date", () => {
  const raw = `---
title: Test
type: post
platforms: [twitter]
schedule: not-a-date
---
Content`;
  assertThrows(() => parseGistContent(raw), GistParseError, "valid ISO 8601");
});

// ─── Utility tests ───────────────────────────────

Deno.test("tagsToHashtags - converts tags to hashtags", () => {
  assertEquals(tagsToHashtags(["tech", "deno", "#already"]), "#tech #deno #already");
});

Deno.test("tagsToHashtags - handles empty array", () => {
  assertEquals(tagsToHashtags([]), "");
});

Deno.test("truncateText - truncates long text", () => {
  const text = "This is a rather long piece of text that exceeds the limit.";
  const result = truncateText(text, 20);
  assertEquals(result.length, 20);
  assertEquals(result, "This is a rather lo…");
});

Deno.test("truncateText - returns short text unchanged", () => {
  assertEquals(truncateText("Hello", 280), "Hello");
});

Deno.test("truncateText - custom suffix", () => {
  assertEquals(truncateText("Hello World", 8, "..."), "Hello...");
});

Deno.test("stripMarkdown - removes headings", () => {
  assertEquals(stripMarkdown("## Hello\n### World"), "Hello\nWorld");
});

Deno.test("stripMarkdown - removes bold and italic", () => {
  assertEquals(stripMarkdown("**bold** and *italic*"), "bold and italic");
});

Deno.test("stripMarkdown - converts links", () => {
  assertEquals(
    stripMarkdown("Check [this link](https://example.com)"),
    "Check this link (https://example.com)",
  );
});

Deno.test("stripMarkdown - removes images", () => {
  assertEquals(stripMarkdown("Text ![alt](img.png) more"), "Text  more");
});

Deno.test("stripMarkdown - removes code blocks", () => {
  assertEquals(stripMarkdown("Before\n```js\nconst x = 1;\n```\nAfter"), "Before\n\nAfter");
});

Deno.test("stripMarkdown - removes inline code", () => {
  assertEquals(stripMarkdown("Use `deno run` command"), "Use deno run command");
});

Deno.test("stripMarkdown - removes strikethrough", () => {
  assertEquals(stripMarkdown("~~deleted~~"), "deleted");
});
