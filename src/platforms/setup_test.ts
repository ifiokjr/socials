import { assertEquals } from "@std/assert";
import { buildUserPreferences, parseDefaultPlatforms } from "./setup.ts";

Deno.test("parseDefaultPlatforms returns [] for empty input", () => {
  assertEquals(parseDefaultPlatforms(""), []);
  assertEquals(parseDefaultPlatforms("   "), []);
});

Deno.test("parseDefaultPlatforms normalizes, validates, and dedupes", () => {
  const parsed = parseDefaultPlatforms(" Twitter, BLUESKY,twitter, invalid, mastodon ");
  assertEquals(parsed, ["twitter", "bluesky", "mastodon"]);
});

Deno.test("buildUserPreferences wraps defaults", () => {
  assertEquals(buildUserPreferences(["twitter", "bluesky"]), {
    defaultPlatforms: ["twitter", "bluesky"],
  });
});
