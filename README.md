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
