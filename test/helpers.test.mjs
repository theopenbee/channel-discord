import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  attachmentType,
  classifyLoginError,
  chunkText,
  decodeRaw,
  downloadFile,
  encodeRaw,
  planAttachments,
  replyTarget,
  stripMention,
} from "../dist/helpers.js";

test("chunkText splits at 2000", () => {
  const text = "a".repeat(4500);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 3);
  for (const c of chunks) assert.ok(c.length <= 2000, `chunk of ${c.length}`);
  assert.equal(chunks.join(""), text);
});

test("chunkText prefers newlines", () => {
  const first = "x".repeat(1500) + "\n";
  const second = "y".repeat(1000);
  const chunks = chunkText(first + second);
  assert.deepEqual(chunks, [first, second]);
});

test("chunkText keeps short text and drops empty", () => {
  assert.deepEqual(chunkText("hello"), ["hello"]);
  assert.deepEqual(chunkText(""), []);
});

test("chunkText never splits a surrogate pair", () => {
  const text = "a".repeat(1999) + "😀" + "b";
  const chunks = chunkText(text);
  assert.equal(chunks.join(""), text);
  for (const c of chunks) assert.doesNotMatch(c, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
});

test("stripMention removes both forms", () => {
  assert.equal(stripMention("<@123> hello", "123"), "hello");
  assert.equal(stripMention("hey <@!123>, look", "123"), "hey , look");
  assert.equal(stripMention("<@999> hi", "123"), "<@999> hi");
});

test("attachmentType maps content types", () => {
  assert.equal(attachmentType("image/png"), "image");
  assert.equal(attachmentType("audio/ogg"), "audio");
  assert.equal(attachmentType("video/mp4"), "video");
  assert.equal(attachmentType("application/pdf"), "document");
  assert.equal(attachmentType(null), "document");
});

test("raw round-trips", () => {
  const raw = encodeRaw({ channel_id: "c1", message_id: "m1" });
  assert.deepEqual(decodeRaw(raw), { channel_id: "c1", message_id: "m1" });
  assert.equal(decodeRaw("not json"), undefined);
  assert.equal(decodeRaw(undefined), undefined);
});

test("oversized attachment becomes placeholder", () => {
  const plan = planAttachments(
    [
      { name: "a.png", size: 10 },
      { name: "big.zip", size: 100 },
    ],
    50,
  );
  assert.deepEqual(
    plan.keep.map((a) => a.name),
    ["a.png"],
  );
  assert.deepEqual(plan.notes, ["[attachment too large: big.zip]"]);
});

test("classifyLoginError detects config problems", () => {
  const coded = Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" });
  assert.equal(classifyLoginError(coded), "token");
  assert.equal(classifyLoginError(new Error("Used disallowed intents")), "intents");
  assert.equal(classifyLoginError(Object.assign(new Error("x"), { code: "DisallowedIntents" })), "intents");
  assert.equal(classifyLoginError(new Error("Authentication failed")), "token");
  assert.equal(classifyLoginError(new Error("getaddrinfo ENOTFOUND discord.com")), undefined);
  assert.equal(classifyLoginError("weird"), undefined);
});

async function mediaServer(t, handler) {
  let requests = 0;
  const server = createServer((req, res) => handler(++requests, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}/file`, requests: () => requests };
}

test("a dropped download is retried until the file arrives", async (t) => {
  const { url, requests } = await mediaServer(t, (n, res) => {
    if (n === 1) return res.socket.destroy();
    if (n === 2) {
      res.writeHead(503);
      return res.end();
    }
    res.end("payload");
  });
  const retries = [];
  const data = await downloadFile(url, { delay: 1, onRetry: (err) => retries.push(err) });
  assert.equal(Buffer.from(data).toString(), "payload");
  assert.equal(requests(), 3);
  assert.equal(retries.length, 2);
});

test("a download that keeps failing stops after three attempts", async (t) => {
  const { url, requests } = await mediaServer(t, (n, res) => {
    res.writeHead(500);
    res.end();
  });
  await assert.rejects(downloadFile(url, { delay: 1 }), /HTTP 500/);
  assert.equal(requests(), 3);
});

test("a stalled download times out and is retried", async (t) => {
  const { url, requests } = await mediaServer(t, () => {});
  await assert.rejects(downloadFile(url, { delay: 1, timeout: 20 }));
  assert.equal(requests(), 3);
});

test("replyTarget picks the first Discord message id", () => {
  assert.equal(replyTarget("123", "456"), "123");
  assert.equal(replyTarget("button:123", "456"), "456");
  assert.equal(replyTarget(undefined, undefined), undefined);
  assert.equal(replyTarget("abc"), undefined);
});
