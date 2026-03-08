import { assertEquals, assertRejects } from "@std/assert";
import { PublishEngine } from "./engine.ts";
import { Store } from "../db/store.ts";

function makeEngine(store: Store) {
  return new PublishEngine({
    githubToken: "ghp_test",
    userId: "user-1",
    store,
    encryptionSecret: "test-encryption-secret-for-unit-tests",
  });
}

Deno.test("processGist uses defaultPlatforms when frontmatter has none", async () => {
  const store = new Store(":memory:");
  await store.init();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    const gistResponse = {
      id: "g1",
      files: {
        "post.md": {
          filename: "post.md",
          content: "---\ntitle: Hello\ntype: post\nplatforms: []\n---\nBody",
          raw_url: "https://example.com/raw/post.md",
        },
      },
    };
    return Promise.resolve(new Response(JSON.stringify(gistResponse), { status: 200 }));
  }) as typeof fetch;

  try {
    const engine = makeEngine(store);
    const publication = await engine.processGist("g1", {
      defaultPlatforms: ["twitter"],
    });

    assertEquals(publication.content.meta.platforms, ["twitter"]);
    assertEquals(publication.platforms.length, 1);
    assertEquals(publication.platforms[0].platform, "twitter");
    assertEquals(publication.platforms[0].status, "skipped");
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

Deno.test("processGist throws when no frontmatter platforms and no defaults", async () => {
  const store = new Store(":memory:");
  await store.init();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    const gistResponse = {
      id: "g2",
      files: {
        "post.md": {
          filename: "post.md",
          content: "---\ntitle: Hello\ntype: post\nplatforms: []\n---\nBody",
          raw_url: "https://example.com/raw/post.md",
        },
      },
    };
    return Promise.resolve(new Response(JSON.stringify(gistResponse), { status: 200 }));
  }) as typeof fetch;

  try {
    const engine = makeEngine(store);
    await assertRejects(
      () => engine.processGist("g2"),
      Error,
      "No publish platforms found in gist frontmatter and no default platforms configured",
    );
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});
