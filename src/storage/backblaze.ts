import { encodeHex } from "@std/encoding/hex";
import type { B2AuthResponse, B2FileInfo, B2UploadUrl } from "../types.ts";

export interface BackblazeClientOptions {
  keyId: string;
  appKey: string;
  bucketId: string;
  bucketName: string;
}

/**
 * Backblaze B2 client for uploading/managing media files.
 */
export class BackblazeClient {
  #keyId: string;
  #appKey: string;
  #bucketId: string;
  #bucketName: string;
  #auth: B2AuthResponse | null = null;
  #authExpiry = 0;

  constructor(opts: BackblazeClientOptions) {
    this.#keyId = opts.keyId;
    this.#appKey = opts.appKey;
    this.#bucketId = opts.bucketId;
    this.#bucketName = opts.bucketName;
  }

  /** Authorize with B2 API */
  async authorize(): Promise<B2AuthResponse> {
    if (this.#auth && Date.now() < this.#authExpiry) {
      return this.#auth;
    }

    const credentials = btoa(`${this.#keyId}:${this.#appKey}`);
    const res = await fetch(
      "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
      {
        headers: { Authorization: `Basic ${credentials}` },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`B2 auth failed (${res.status}): ${body}`);
    }

    this.#auth = (await res.json()) as B2AuthResponse;
    // Tokens valid for ~24h, refresh at 23h
    this.#authExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return this.#auth;
  }

  /** Get an upload URL for the bucket */
  async getUploadUrl(): Promise<B2UploadUrl> {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bucketId: this.#bucketId }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`Failed to get upload URL (${res.status}): ${body}`);
    }

    return (await res.json()) as B2UploadUrl;
  }

  /** Upload a file to B2 */
  async uploadFile(
    filename: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<B2FileInfo> {
    const uploadUrl = await this.getUploadUrl();

    // Compute SHA1 hash
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    const hashBuffer = await crypto.subtle.digest("SHA-1", buf);
    const sha1 = encodeHex(new Uint8Array(hashBuffer));

    const res = await fetch(uploadUrl.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: uploadUrl.authorizationToken,
        "X-Bz-File-Name": encodeURIComponent(filename),
        "Content-Type": contentType,
        "Content-Length": String(data.length),
        "X-Bz-Content-Sha1": sha1,
      },
      body: buf,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`Upload failed (${res.status}): ${body}`);
    }

    return (await res.json()) as B2FileInfo;
  }

  /** Get the public/friendly download URL for a file */
  getDownloadUrl(filename: string): string {
    return `https://f005.backblazeb2.com/file/${this.#bucketName}/${filename}`;
  }

  /** Download a file by name */
  async downloadFile(filename: string): Promise<Uint8Array> {
    const auth = await this.authorize();
    const url = `${auth.downloadUrl}/file/${this.#bucketName}/${filename}`;

    const res = await fetch(url, {
      headers: { Authorization: auth.authorizationToken },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`Download failed (${res.status}): ${body}`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  /** Delete a file version */
  async deleteFile(fileId: string, fileName: string): Promise<void> {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_delete_file_version`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileId, fileName }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`Delete failed (${res.status}): ${body}`);
    }
  }

  /** List files in the bucket */
  async listFiles(prefix?: string): Promise<B2FileInfo[]> {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_list_file_names`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bucketId: this.#bucketId,
        prefix: prefix ?? "",
        maxFileCount: 1000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BackblazeError(`List files failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.files as B2FileInfo[];
  }
}

export class BackblazeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackblazeError";
  }
}

/** Guess MIME type from filename */
export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    pdf: "application/pdf",
  };
  return mimeMap[ext ?? ""] ?? "application/octet-stream";
}
