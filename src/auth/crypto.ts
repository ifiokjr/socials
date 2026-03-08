/**
 * AES-256-GCM encryption for storing user credentials in KV.
 * The encryption key is derived from a server secret via HKDF.
 */

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

/** Derive an AES key from the server secret + a per-user salt. */
async function deriveKey(secret: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      info: encoder.encode("socials-credentials"),
    },
    baseKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedBlob {
  /** Base64-encoded ciphertext */
  ct: string;
  /** Base64-encoded IV */
  iv: string;
}

/** Encrypt a plaintext string. Returns base64-encoded ciphertext + IV. */
export async function encrypt(
  plaintext: string,
  secret: string,
  salt: string,
): Promise<EncryptedBlob> {
  const key = await deriveKey(secret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  );

  return {
    ct: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/** Decrypt a previously-encrypted blob back to plaintext. */
export async function decrypt(
  blob: EncryptedBlob,
  secret: string,
  salt: string,
): Promise<string> {
  const key = await deriveKey(secret, salt);
  const iv = Uint8Array.from(atob(blob.iv), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(blob.ct), (c) => c.charCodeAt(0));

  const plainBuffer = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ct,
  );

  return new TextDecoder().decode(plainBuffer);
}
