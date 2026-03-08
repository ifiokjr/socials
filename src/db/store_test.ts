import { assertEquals } from "@std/assert";
import { Store } from "./store.ts";
import type { Publication } from "../types.ts";

const USER = "user-1";

function makePub(overrides: Partial<Publication> = {}): Publication {
  return {
    id: crypto.randomUUID(),
    gistId: "gist123",
    userId: USER,
    content: {
      meta: {
        title: "Test Post",
        type: "post",
        platforms: ["twitter"],
      },
      body: "Hello world",
      raw: "---\ntitle: Test Post\ntype: post\nplatforms: [twitter]\n---\nHello world",
    },
    media: [],
    platforms: [
      {
        platform: "twitter",
        status: "published",
        publishedAt: new Date().toISOString(),
        retryCount: 0,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function tempStore(): Promise<Store> {
  const store = new Store(":memory:");
  await store.init();
  return store;
}

Deno.test("Store - init, save, get, getAll", async () => {
  const store = await tempStore();

  assertEquals(await store.getAll(USER), []);

  const pub = makePub({ id: "pub-1", gistId: "gist-a" });
  await store.save(USER, pub);

  const found = await store.get(USER, "pub-1");
  assertEquals(found?.id, "pub-1");
  assertEquals(found?.gistId, "gist-a");

  const byGist = await store.getByGistId(USER, "gist-a");
  assertEquals(byGist?.id, "pub-1");

  assertEquals((await store.getAll(USER)).length, 1);

  store.close();
});

Deno.test("Store - sort newest first", async () => {
  const store = await tempStore();

  await store.save(USER, makePub({ id: "old", createdAt: "2025-01-01T00:00:00Z" }));
  await store.save(USER, makePub({ id: "new", createdAt: "2026-01-01T00:00:00Z" }));

  const all = await store.getAll(USER);
  assertEquals(all.length, 2);
  assertEquals(all[0].id, "new");
  assertEquals(all[1].id, "old");

  store.close();
});

Deno.test("Store - delete removes publication and indexes", async () => {
  const store = await tempStore();

  await store.save(USER, makePub({ id: "to-delete", gistId: "gist-del" }));
  assertEquals((await store.getAll(USER)).length, 1);

  assertEquals(await store.delete(USER, "to-delete"), true);
  assertEquals((await store.getAll(USER)).length, 0);
  assertEquals(await store.getByGistId(USER, "gist-del"), undefined);
  assertEquals(await store.delete(USER, "nope"), false);

  store.close();
});

Deno.test("Store - clear removes all for user", async () => {
  const store = await tempStore();

  await store.save(USER, makePub({ id: "a", gistId: "g1" }));
  await store.save(USER, makePub({ id: "b", gistId: "g2" }));
  assertEquals((await store.getAll(USER)).length, 2);

  await store.clear(USER);
  assertEquals((await store.getAll(USER)).length, 0);
  assertEquals(await store.getByGistId(USER, "g1"), undefined);

  store.close();
});

Deno.test("Store - multi-tenant isolation", async () => {
  const store = await tempStore();

  await store.save("alice", makePub({ id: "a1", gistId: "ga", userId: "alice" }));
  await store.save("bob", makePub({ id: "b1", gistId: "gb", userId: "bob" }));

  assertEquals((await store.getAll("alice")).length, 1);
  assertEquals((await store.getAll("bob")).length, 1);
  assertEquals(await store.get("alice", "b1"), undefined);
  assertEquals(await store.get("bob", "a1"), undefined);

  store.close();
});

Deno.test("Store - credential CRUD", async () => {
  const store = await tempStore();

  assertEquals(await store.getCredentials(USER, "twitter"), undefined);

  const blob = { ct: "enc-data", iv: "iv-data" };
  await store.setCredentials(USER, "twitter", blob);
  assertEquals(await store.getCredentials(USER, "twitter"), blob);

  const platforms = await store.listConfiguredPlatforms(USER);
  assertEquals(platforms, ["twitter"]);

  await store.deleteCredentials(USER, "twitter");
  assertEquals(await store.getCredentials(USER, "twitter"), undefined);

  store.close();
});

Deno.test("Store - storage config CRUD", async () => {
  const store = await tempStore();

  assertEquals(await store.getStorageConfig(USER), undefined);

  const blob = { ct: "s3-data", iv: "iv" };
  await store.setStorageConfig(USER, blob);
  assertEquals(await store.getStorageConfig(USER), blob);

  await store.deleteStorageConfig(USER);
  assertEquals(await store.getStorageConfig(USER), undefined);

  store.close();
});

Deno.test("Store - user profile CRUD", async () => {
  const store = await tempStore();

  assertEquals(await store.getUser(USER), undefined);

  const profile = {
    id: USER,
    githubId: 12345,
    login: "testuser",
    name: "Test User",
    avatarUrl: "https://example.com/avatar.png",
    email: "test@example.com",
    createdAt: new Date().toISOString(),
  };

  await store.saveUser(profile);
  const found = await store.getUser(USER);
  assertEquals(found?.login, "testuser");
  assertEquals(found?.githubId, 12345);

  store.close();
});
