/**
 * GitHub OAuth 2.0 flow helpers.
 *
 * Scopes requested:
 *   - read:user   → profile info
 *   - gist        → read + write gists
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Must match the callback registered in the GitHub OAuth App settings. */
  redirectUri: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

const SCOPES = "read:user gist";

/** Build the GitHub authorize URL the user should be redirected to. */
export function buildAuthorizeUrl(cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/** Exchange the temporary `code` for an access token. */
export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
): Promise<GitHubTokenResponse> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }

  const data = (await res.json()) as GitHubTokenResponse & { error?: string };
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error}`);
  }
  return data;
}

/** Fetch the authenticated user's profile from GitHub. */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }

  return (await res.json()) as GitHubUser;
}
