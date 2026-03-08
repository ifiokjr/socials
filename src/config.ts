import "@std/dotenv/load";

/**
 * Server-level configuration loaded from environment variables.
 *
 * Per-user platform credentials are stored encrypted in Deno KV,
 * NOT in env vars.
 */
import { parseDefaultPlatforms } from "./platforms/setup.ts";
import type { Platform } from "./types.ts";

export interface AppConfig {
  server: {
    port: number;
    host: string;
    /** Base URL of the running app (for OAuth redirects). */
    baseUrl: string;
    /** True when running on Deno Deploy (or CI). */
    isProduction: boolean;
  };
  github: {
    /** OAuth App client ID (server-level, not per-user). */
    clientId: string;
    /** OAuth App client secret. */
    clientSecret: string;
  };
  /** Secret used to derive AES keys for encrypting user credentials in KV. */
  encryptionSecret: string;
  defaults: {
    /** Default platforms preselected for each user when publishing. */
    publishPlatforms: Platform[];
  };
}

function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export function loadConfig(): AppConfig {
  const port = parseInt(env("PORT", "3000"));
  const host = env("HOST", "0.0.0.0");
  const isProd = env("DENO_DEPLOYMENT_ID") !== "" || env("CI") !== "";
  const baseUrl = env("BASE_URL", `http://localhost:${port}`);

  const encryptionSecret = env("ENCRYPTION_SECRET");

  if (isProd && !encryptionSecret) {
    throw new Error(
      "ENCRYPTION_SECRET must be set in production. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  if (!isProd && !encryptionSecret) {
    console.warn(
      "⚠️  ENCRYPTION_SECRET not set — using default dev secret. " +
        "Set it in .env before deploying.",
    );
  }

  return {
    server: {
      port,
      host,
      baseUrl,
      isProduction: isProd,
    },
    github: {
      clientId: env("GITHUB_CLIENT_ID"),
      clientSecret: env("GITHUB_CLIENT_SECRET"),
    },
    encryptionSecret: encryptionSecret || "dev-secret-change-me-in-production",
    defaults: {
      publishPlatforms: parseDefaultPlatforms(env("DEFAULT_PUBLISH_PLATFORMS")),
    },
  };
}
