import { assertEquals } from "@std/assert";
import { guessMimeType } from "./s3.ts";

Deno.test("guessMimeType - image types", () => {
  assertEquals(guessMimeType("photo.jpg"), "image/jpeg");
  assertEquals(guessMimeType("photo.jpeg"), "image/jpeg");
  assertEquals(guessMimeType("icon.png"), "image/png");
  assertEquals(guessMimeType("anim.gif"), "image/gif");
  assertEquals(guessMimeType("modern.webp"), "image/webp");
  assertEquals(guessMimeType("logo.svg"), "image/svg+xml");
});

Deno.test("guessMimeType - video types", () => {
  assertEquals(guessMimeType("clip.mp4"), "video/mp4");
  assertEquals(guessMimeType("clip.webm"), "video/webm");
  assertEquals(guessMimeType("clip.mov"), "video/quicktime");
  assertEquals(guessMimeType("clip.avi"), "video/x-msvideo");
  assertEquals(guessMimeType("clip.mkv"), "video/x-matroska");
});

Deno.test("guessMimeType - audio types", () => {
  assertEquals(guessMimeType("song.mp3"), "audio/mpeg");
  assertEquals(guessMimeType("sound.wav"), "audio/wav");
  assertEquals(guessMimeType("audio.ogg"), "audio/ogg");
});

Deno.test("guessMimeType - unknown extension", () => {
  assertEquals(guessMimeType("file.xyz"), "application/octet-stream");
  assertEquals(guessMimeType("noext"), "application/octet-stream");
});
