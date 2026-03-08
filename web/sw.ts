/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

type ManifestEntry = string | { url?: string; file?: string };
type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

const VERSION = "v1";
const CACHE_PREFIX = "social-app";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${VERSION}`;
const OFFLINE_FALLBACK = "/index.html";

const PRECACHE_URLS = new Set<string>([
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
]);

const manifest = (self as ServiceWorkerGlobalScope & { __WB_MANIFEST?: ManifestEntry[] })
  .__WB_MANIFEST;
if (Array.isArray(manifest)) {
  for (const entry of manifest) {
    const raw = typeof entry === "string" ? entry : entry.url ?? entry.file;
    if (!raw) continue;
    PRECACHE_URLS.add(raw.startsWith("/") ? raw : `/${raw}`);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(Array.from(PRECACHE_URLS));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) =>
          key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE
        )
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(navigationFallback(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return (event.data?.json() ?? {}) as PushPayload;
    } catch {
      return { body: event.data?.text() ?? "You have a new update." } as PushPayload;
    }
  })();

  const title = payload.title?.trim() || "Socials";
  const body = payload.body?.trim() || "You have a new update.";
  const url = normalizeNotificationUrl(payload.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: payload.icon ?? "/icons/icon-192.png",
      badge: payload.badge ?? "/icons/icon-192.png",
      tag: payload.tag ?? "socials-notification",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const targetUrl = normalizeNotificationUrl(data?.url);

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      if ("focus" in client) {
        if (client.url === targetUrl || client.url === `${self.location.origin}${targetUrl}`) {
          await client.focus();
          return;
        }
      }
    }

    if ("openWindow" in self.clients) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

function normalizeNotificationUrl(input: string | undefined): string {
  if (!input) return "/";

  try {
    const parsed = new URL(input, self.location.origin);
    if (parsed.origin !== self.location.origin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const network = await networkPromise;
  if (network) return network;

  const shell = await caches.open(SHELL_CACHE);
  return (await shell.match(OFFLINE_FALLBACK)) ?? Response.error();
}

async function navigationFallback(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match("/index.html")) ?? Response.error();
  }
}
