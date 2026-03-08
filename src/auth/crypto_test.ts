import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";
import { decrypt, encrypt } from "./crypto.ts";

Deno.test("encrypt → decrypt round-trip", async () => {
  const plaintext = '{"apiKey":"secret123","apiSecret":"shhh"}';
  const secret = "my-server-secret";
  const salt = "user-42";

  const blob = await encrypt(plaintext, secret, salt);

  assertEquals(typeof blob.ct, "string");
  assertEquals(typeof blob.iv, "string");
  assertEquals(blob.ct.length > 0, true);

  const result = await decrypt(blob, secret, salt);
  assertEquals(result, plaintext);
});

Deno.test("decrypt fails with wrong secret", async () => {
  const blob = await encrypt("hello", "correct-secret", "salt");

  await assertRejects(
    () => decrypt(blob, "wrong-secret", "salt"),
  );
});

Deno.test("decrypt fails with wrong salt", async () => {
  const blob = await encrypt("hello", "secret", "correct-salt");

  await assertRejects(
    () => decrypt(blob, "secret", "wrong-salt"),
  );
});

Deno.test("each encryption produces unique ciphertext (random IV)", async () => {
  const plaintext = "same-input";
  const secret = "secret";
  const salt = "salt";

  const a = await encrypt(plaintext, secret, salt);
  const b = await encrypt(plaintext, secret, salt);

  // Different IVs → different ciphertext
  assertEquals(a.iv !== b.iv, true);
  assertEquals(a.ct !== b.ct, true);

  // Both decrypt to the same value
  assertEquals(await decrypt(a, secret, salt), plaintext);
  assertEquals(await decrypt(b, secret, salt), plaintext);
});
