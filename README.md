# 📡 Socials

**Publish once, post everywhere.** Sign in with GitHub, write content as Gists, and this platform publishes to all your social networks.

## How It Works

1. **Sign in with GitHub** → grants Gist access
2. **Connect platforms** → setup wizard for each network, credentials encrypted at rest
3. **Bring your own storage** → any S3-compatible service (Backblaze B2, Cloudflare R2, AWS S3…)
4. **Write a Gist** → markdown with YAML frontmatter specifying title, type, platforms, media
5. **Hit Publish** → the engine parses, uploads media, and posts to every platform

## Supported Platforms

| Platform    | Posts | Images | Video | Blog Links |
| ----------- | ----- | ------ | ----- | ---------- |
| X (Twitter) | ✅    | ✅     | ✅    | ✅         |
| Facebook    | ✅    | ✅     | ✅    | ✅         |
| Instagram   | ✅    | ✅     | ✅    | ❌         |
| LinkedIn    | ✅    | ✅     | ✅    | ✅         |
| YouTube     | ❌    | ❌     | ✅    | ✅         |
| Mastodon    | ✅    | ✅     | ✅    | ✅         |
| Bluesky     | ✅    | ✅     | ✅    | ✅         |
| TikTok      | ✅    | ✅     | ✅    | ❌         |
| Pinterest   | ✅    | ✅     | ✅    | ✅         |
| Threads     | ✅    | ✅     | ✅    | ✅         |
| Reddit      | ✅    | ✅     | ✅    | ✅         |

## Gist Format

Create a `.md` file in a Gist with YAML frontmatter:

```markdown
---
title: My Cross-Platform Post
type: post          # post | blog | video
platforms:
  - twitter
  - mastodon
  - bluesky
  - linkedin
tags: [tech, deno]
media:
  - filename: photo.jpg
    type: image
    alt: A beautiful photo
overrides:
  twitter:
    text: "Short tweet version 🚀"
---

This is the content published across all platforms.
Each adapter formats it appropriately.
```

## Getting Started

### Prerequisites

- [Deno](https://deno.com/) v2.x+
- A [GitHub OAuth App](https://github.com/settings/developers) (for login)

### 1. Create a GitHub OAuth App

Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**:

| Field                      | Value                                  |
| -------------------------- | -------------------------------------- |
| Application name           | Socials                                |
| Homepage URL               | `http://localhost:3000`                 |
| Authorization callback URL | `http://localhost:3000/auth/callback`   |

Copy the **Client ID** and generate a **Client Secret**.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
ENCRYPTION_SECRET=$(openssl rand -base64 32)
```

### 3. Run

```bash
# Start the server
deno task dev

# In another terminal — start Vite dev server with HMR
deno task dev:vite
```

Open `http://localhost:3000` and click **Sign in with GitHub**.

### 4. Connect platforms

After login, go to the **Platforms** section and click **Setup** on each platform you want. The wizard tells you exactly which API keys/tokens to create and where to get them. Credentials are **AES-256-GCM encrypted** before storage.

### 5. Connect storage

Go to **Storage** and enter your S3-compatible credentials (works with Backblaze B2, Cloudflare R2, AWS S3, MinIO, etc.). This is where images and videos are uploaded before publishing.

### 6. Publish!

Paste a Gist ID or URL and hit **Publish**. The engine will:
- Parse the frontmatter
- Upload media to your S3 bucket
- Format content per-platform (truncation, hashtags, markdown stripping)
- Publish to all target platforms
- Show per-platform status (success / failure / retry)

## Testing

```bash
# Unit tests (67 tests)
deno task test

# E2E tests with Playwright (6 tests)
deno task test:e2e:install   # first time only
deno task test:e2e
```

## Browser Notifications (Web Push) — Exact Setup Steps

> Status note: this section documents the full implementation flow (client + service worker + server) so you can add or verify browser notifications end-to-end.

### 1) Generate VAPID keys (once per environment)

Use `web-push` (or any VAPID-compatible tool) to generate your key pair:

```bash
npx web-push generate-vapid-keys
```

Example output:

```text
Public Key:
BEl...yourPublicKey...xyz

Private Key:
9mA...yourPrivateKey...abc
```

Save both keys securely.

### 2) Configure environment variables

Add these to your `.env` (or deploy secret manager):

```env
# Web Push (VAPID)
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:you@yourdomain.com
```

Guidance:
- `VAPID_SUBJECT` should be a monitored email or a contact URL.
- Use different keys for local/dev vs production.
- Never expose `VAPID_PRIVATE_KEY` in frontend code.

### 3) Register a service worker in the browser

In your frontend bootstrap (`web/app.ts`), register the service worker after app startup:

```ts
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      console.log("SW registered", registration.scope);
    } catch (error) {
      console.error("SW registration failed", error);
    }
  });
}
```

Create `web/sw.js` (or equivalent build output) with push handlers:

```js
self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {
    title: "Socials",
    body: "You have a new update.",
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Socials", {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: payload.url ? { url: payload.url } : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
```

### 4) Request permission and subscribe user

Best practice: ask only after user intent (not on first paint). For example, after successful login or first publish.

```ts
async function subscribeToPush(registration: ServiceWorkerRegistration) {
  if (!("Notification" in window) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(`Permission not granted: ${permission}`);
  }

  const vapidPublicKey = "<from /api/push/public-key or injected config>";
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription),
  });

  return subscription;
}
```

Helper:

```ts
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
```

### 5) Trigger/send a notification (server)

Server flow:
1. Store subscriptions per user (`endpoint`, `keys.p256dh`, `keys.auth`).
2. When an event happens (e.g., publication success/failure), load subscriptions.
3. Send push payload with your VAPID private key.
4. Remove expired subscriptions (`410 Gone`).

Example (Node-style with `web-push`; adapt to Deno runtime as needed):

```ts
import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

await webpush.sendNotification(subscription, JSON.stringify({
  title: "✅ Publish complete",
  body: "Your post was published to X, LinkedIn, and Mastodon.",
  url: "/publications",
}));
```

### 6) Unsubscribe flow

Allow users to disable notifications in-app:

```ts
const registration = await navigator.serviceWorker.ready;
const sub = await registration.pushManager.getSubscription();
if (sub) {
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}
```

Also document browser-level fallback:
- Users can revoke permission in site settings (lock icon → Notifications).
- Your backend should gracefully handle stale subscriptions.

### 7) Local verification checklist

1. Start app and verify SW registration in DevTools → Application → Service Workers.
2. Confirm permission becomes `granted` after user action.
3. Confirm subscription appears in backend storage.
4. Trigger a test notification from server.
5. Verify notification click opens expected URL.
6. Unsubscribe and confirm no further pushes are delivered.

### 8) Troubleshooting

- **`Notification.permission = denied`**
  - User previously blocked notifications. Re-enable in browser site settings.
- **`subscribe()` fails with `InvalidStateError`**
  - SW may not be active yet; wait for `navigator.serviceWorker.ready`.
- **No push received but subscription exists**
  - Check VAPID keys match between client public key and server private/public pair.
  - Check payload format and service worker `push` handler.
- **Works locally, fails in production**
  - Ensure HTTPS is enabled (required for Push API, except localhost).
  - Verify reverse proxy/CDN is not caching old `sw.js` forever.
- **Got `410 Gone` from push provider**
  - Subscription expired/invalid. Delete it from your DB and request re-subscription.

### 9) Recommended prompt copy + timing guidance

Use a soft pre-prompt before the native browser permission dialog.

Recommended copy:

- **Title:** `Stay in the loop?`
- **Body:** `Get notified when your posts finish publishing or need attention. No spam — only important account activity.`
- **Primary CTA:** `Enable notifications`
- **Secondary CTA:** `Not now`

Timing guidance:
- ✅ Ask after a meaningful action (first successful publish, platform connection, or when user opens Publications page).
- ✅ Delay prompt until user is authenticated and understands value.
- ✅ If dismissed, wait before re-prompting (e.g., 7–14 days).
- ❌ Do not trigger browser permission request immediately on first visit.

## Deploy to Deno Deploy

### 1. Create the repo

```bash
gh repo create ifiokjr/socials --public --source=. --push
```

### 2. Link to Deno Deploy

Go to [dash.deno.com](https://dash.deno.com):

1. **New Project** → link `ifiokjr/socials`
2. Set entrypoint: `src/main.ts`
3. Add environment variables:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `ENCRYPTION_SECRET`
   - `BASE_URL` → `https://socials.deno.dev` (your deploy URL)
4. Enable **Deno KV** database for the project

Every push to `main` auto-deploys.

### 3. Update GitHub OAuth callback

In your GitHub OAuth App settings, update the callback URL to:

```
https://socials.deno.dev/auth/callback
```

## API Endpoints

### Public
| Method | Path             | Description              |
| ------ | ---------------- | ------------------------ |
| GET    | `/api/health`    | Health check             |
| GET    | `/api/me`        | Current user (or null)   |
| GET    | `/auth/login`    | Redirect to GitHub OAuth |
| GET    | `/auth/callback` | OAuth callback           |
| POST   | `/auth/logout`   | End session              |

### Authenticated
| Method | Path                              | Description                        |
| ------ | --------------------------------- | ---------------------------------- |
| GET    | `/api/platforms`                  | List platforms + config status     |
| GET    | `/api/platforms/:id/setup`        | Setup wizard fields for a platform |
| POST   | `/api/platforms/:id/setup`        | Save platform credentials          |
| DELETE | `/api/platforms/:id`              | Remove platform credentials        |
| GET    | `/api/storage`                    | Storage config status              |
| POST   | `/api/storage`                    | Save S3 storage config             |
| DELETE | `/api/storage`                    | Remove storage config              |
| GET    | `/api/publications`               | List user's publications           |
| GET    | `/api/publications/:id`           | Get one publication                |
| POST   | `/api/publish`                    | Publish a gist `{ gistId }`        |
| POST   | `/api/publications/:id/retry`     | Retry failed platforms             |
| DELETE | `/api/publications/:id`           | Delete a publication record        |

## Architecture

```
GitHub OAuth ──→ Session (KV, 30-day TTL)
                    │
User's Gist ──→ Parser ──→ Media Upload (User's S3) ──→ Platform Adapters ──→ Networks
                    │              │                           │
                    └─── Deno KV ──┴───────────────────────────┘
                          │  publications (per-user)
                          │  credentials  (AES-256-GCM encrypted)
                          │  storage cfg  (AES-256-GCM encrypted)
                          │  sessions     (30-day TTL)
                          │  user profiles
                          │
                     API Server (Hono)
                          │
                    Dashboard (Vite)
```

## Tech Stack

- **Runtime**: Deno
- **Server**: Hono
- **Database**: Deno KV (multi-tenant, with secondary indexes)
- **Auth**: GitHub OAuth 2.0, cookie-based sessions
- **Encryption**: AES-256-GCM (HKDF-derived per-user keys)
- **Storage**: Any S3-compatible (user-provided)
- **Frontend**: Vite + vanilla TypeScript
- **Testing**: Deno test (unit), Playwright (E2E)
- **Deploy**: Deno Deploy (push-to-deploy)
