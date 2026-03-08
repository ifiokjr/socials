import { encodeHex } from "@std/encoding/hex";
import type { S3StorageConfig } from "../types.ts";

/**
 * Minimal S3-compatible client that works with any S3-API provider
 * (AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.).
 *
 * Uses AWS Signature V4 for authentication.
 */
export class S3Client {
  #cfg: S3StorageConfig;

  constructor(cfg: S3StorageConfig) {
    this.#cfg = cfg;
  }

  /** Upload a file and return its public URL. */
  async upload(key: string, data: Uint8Array, contentType: string): Promise<string> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

    const host = this.#host();
    const url = `${this.#cfg.endpoint}/${this.#cfg.bucket}/${key}`;

    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    const payloadHash = encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));

    const headers: Record<string, string> = {
      Host: host,
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    const signedHeaders = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .join(";");

    const canonicalHeaders = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .map((h) => `${h}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === h)!]}`)
      .join("\n") + "\n";

    const canonicalRequest = [
      "PUT",
      `/${this.#cfg.bucket}/${key}`,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.#cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      encodeHex(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(canonicalRequest),
          ),
        ),
      ),
    ].join("\n");

    const signingKey = await this.#deriveSigningKey(dateStamp);
    const signature = encodeHex(
      new Uint8Array(await this.#hmac(signingKey, stringToSign)),
    );

    headers["Authorization"] =
      `AWS4-HMAC-SHA256 Credential=${this.#cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: buf,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`S3 upload failed (${res.status}): ${body}`);
    }

    // Return a public-ish URL (user can configure CDN / bucket policy)
    return `${this.#cfg.endpoint}/${this.#cfg.bucket}/${key}`;
  }

  #host(): string {
    return new URL(this.#cfg.endpoint).host;
  }

  async #deriveSigningKey(dateStamp: string): Promise<ArrayBuffer> {
    const enc = new TextEncoder();
    let key: ArrayBuffer = await this.#hmac(
      enc.encode("AWS4" + this.#cfg.secretAccessKey),
      dateStamp,
    );
    key = await this.#hmac(key, this.#cfg.region);
    key = await this.#hmac(key, "s3");
    key = await this.#hmac(key, "aws4_request");
    return key;
  }

  async #hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
    const buf = key instanceof Uint8Array
      ? (() => { const b = new ArrayBuffer(key.byteLength); new Uint8Array(b).set(key); return b; })()
      : key;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      buf,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
  }
}

/** Guess MIME type from filename extension. */
export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
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
  return map[ext ?? ""] ?? "application/octet-stream";
}
