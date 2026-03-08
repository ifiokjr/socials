import { assertEquals } from "@std/assert";
import { ALL_PLATFORMS, buildAdapter, PLATFORM_SETUP } from "./mod.ts";

Deno.test("ALL_PLATFORMS has 11 entries", () => {
  assertEquals(ALL_PLATFORMS.length, 11);
});

Deno.test("PLATFORM_SETUP has entry for every platform", () => {
  assertEquals(PLATFORM_SETUP.length, 11);
  for (const p of ALL_PLATFORMS) {
    assertEquals(PLATFORM_SETUP.some((s) => s.platform === p), true);
  }
});

Deno.test("PLATFORM_SETUP entries have required fields", () => {
  for (const s of PLATFORM_SETUP) {
    assertEquals(typeof s.displayName, "string");
    assertEquals(typeof s.icon, "string");
    assertEquals(typeof s.description, "string");
    assertEquals(typeof s.docsUrl, "string");
    assertEquals(s.fields.length > 0, true);

    for (const f of s.fields) {
      assertEquals(typeof f.key, "string");
      assertEquals(typeof f.label, "string");
      assertEquals(["text", "password", "url"].includes(f.type), true);
    }
  }
});

Deno.test("buildAdapter creates adapters for all platforms", () => {
  for (const p of ALL_PLATFORMS) {
    // Empty creds — adapter should still construct
    const adapter = buildAdapter(p, {});
    assertEquals(adapter.platform, p);
    assertEquals(typeof adapter.displayName, "string");
    assertEquals(typeof adapter.maxTextLength, "number");
    assertEquals(typeof adapter.supportsImages, "boolean");
    assertEquals(typeof adapter.supportsVideo, "boolean");
  }
});

Deno.test("buildAdapter - twitter adapter properties", () => {
  const adapter = buildAdapter("twitter", {
    apiKey: "k",
    apiSecret: "s",
    accessToken: "t",
    accessTokenSecret: "ts",
  });
  assertEquals(adapter.platform, "twitter");
  assertEquals(adapter.displayName, "X (Twitter)");
  assertEquals(adapter.maxTextLength, 280);
  assertEquals(adapter.supportsImages, true);
  assertEquals(adapter.supportsVideo, true);
  assertEquals(adapter.isConfigured(), true);
});

Deno.test("buildAdapter - unconfigured adapter returns false", () => {
  const adapter = buildAdapter("twitter", {});
  assertEquals(adapter.isConfigured(), false);
});

Deno.test("buildAdapter - youtube properties", () => {
  const adapter = buildAdapter("youtube", {});
  assertEquals(adapter.platform, "youtube");
  assertEquals(adapter.supportsImages, false);
  assertEquals(adapter.supportsVideo, true);
});

Deno.test("buildAdapter - instagram properties", () => {
  const adapter = buildAdapter("instagram", {});
  assertEquals(adapter.platform, "instagram");
  assertEquals(adapter.supportsBlogLinks, false);
});

Deno.test("PlatformAdapter - validate checks text length", () => {
  const adapter = buildAdapter("mastodon", {
    instanceUrl: "https://mastodon.social",
    accessToken: "tok",
  });

  const content = {
    meta: {
      title: "Test",
      type: "post" as const,
      platforms: ["mastodon" as const],
      overrides: { mastodon: { text: "x".repeat(600) } },
    },
    body: "x".repeat(600),
    raw: "",
  };

  const issues = adapter.validate(content, []);
  assertEquals(issues.length > 0, true);
  assertEquals(issues[0].includes("exceeds"), true);
});

Deno.test("PlatformAdapter - validate checks media support", () => {
  const adapter = buildAdapter("youtube", {});

  const content = {
    meta: { title: "Test", type: "video" as const, platforms: ["youtube" as const] },
    body: "Video post",
    raw: "",
  };

  const issues = adapter.validate(content, [
    { filename: "photo.jpg", type: "image" as const },
  ]);
  assertEquals(issues.some((i) => i.includes("does not support image")), true);
});

Deno.test("PlatformAdapter - buildPostText appends tags", () => {
  const adapter = buildAdapter("mastodon", {});

  const content = {
    meta: {
      title: "Test",
      type: "post" as const,
      platforms: ["mastodon" as const],
      tags: ["deno", "typescript"],
    },
    body: "Hello world",
    raw: "",
  };

  const text = adapter.buildPostText(content);
  assertEquals(text.includes("#deno"), true);
  assertEquals(text.includes("#typescript"), true);
});

Deno.test("PlatformAdapter - formatText uses override", () => {
  const adapter = buildAdapter("twitter", {});

  const content = {
    meta: {
      title: "Test",
      type: "post" as const,
      platforms: ["twitter" as const],
      overrides: { twitter: { text: "Custom tweet text!" } },
    },
    body: "This is the default body text that is quite long",
    raw: "",
  };

  const text = adapter.formatText(content);
  assertEquals(text, "Custom tweet text!");
});
