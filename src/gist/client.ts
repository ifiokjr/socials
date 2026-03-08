import type { Gist, RecentGist } from "../types.ts";

const GITHUB_API = "https://api.github.com";

export interface GistClientOptions {
  token: string;
}

/**
 * GitHub Gist API client.
 * Fetches gists and their content for use as a content source.
 */
export class GistClient {
  #token: string;

  constructor(opts: GistClientOptions) {
    this.#token = opts.token;
  }

  #headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${GITHUB_API}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.#headers(), ...init?.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new GistApiError(`GitHub API ${res.status}: ${body}`, res.status);
    }

    return (await res.json()) as T;
  }

  /** List authenticated user's gists */
  async list(opts?: { perPage?: number; page?: number; since?: string }): Promise<Gist[]> {
    const params = new URLSearchParams();
    if (opts?.perPage) params.set("per_page", String(opts.perPage));
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.since) params.set("since", opts.since);

    const query = params.toString();
    return this.#request<Gist[]>(`/gists${query ? `?${query}` : ""}`);
  }

  /** Get a single gist by ID (includes file content) */
  async get(gistId: string): Promise<Gist> {
    return this.#request<Gist>(`/gists/${gistId}`);
  }

  /** Create a new gist */
  async create(opts: {
    description: string;
    public: boolean;
    files: Record<string, { content: string }>;
  }): Promise<Gist> {
    return this.#request<Gist>("/gists", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  /** Update a gist */
  async update(gistId: string, opts: {
    description?: string;
    files?: Record<string, { content: string } | null>;
  }): Promise<Gist> {
    return this.#request<Gist>(`/gists/${gistId}`, {
      method: "PATCH",
      body: JSON.stringify(opts),
    });
  }

  /** Download raw file content from a gist file's raw_url */
  async downloadFile(rawUrl: string): Promise<Uint8Array> {
    const res = await fetch(rawUrl, {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!res.ok) {
      throw new GistApiError(`Failed to download file: ${res.status}`, res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * List gists that contain markdown files with our frontmatter marker.
   * Returns gists that have at least one `.md` file.
   */
  async listPublishableGists(opts?: { since?: string }): Promise<Gist[]> {
    const gists = await this.list({ perPage: 100, since: opts?.since });
    return gists.filter((g) =>
      Object.values(g.files).some((f) =>
        f.filename.endsWith(".md") || f.filename.endsWith(".markdown")
      )
    );
  }

  /**
   * Recent markdown gists in a UI-friendly format.
   */
  async listRecentPublishableGists(opts?: {
    since?: string;
    limit?: number;
  }): Promise<RecentGist[]> {
    const gists = await this.listPublishableGists({ since: opts?.since });
    const limited = gists.slice(0, opts?.limit ?? 10);
    return limited.map((gist) => ({
      id: gist.id,
      description: gist.description || "Untitled gist",
      htmlUrl: gist.html_url,
      updatedAt: gist.updated_at,
      ownerLogin: gist.owner?.login,
      publishedPlatforms: [],
      markdownFiles: Object.values(gist.files)
        .map((f) => f.filename)
        .filter((name) => name.endsWith(".md") || name.endsWith(".markdown")),
    }));
  }
}

export class GistApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GistApiError";
    this.status = status;
  }
}
