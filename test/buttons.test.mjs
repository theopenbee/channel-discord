import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUTTONS_FILE, ButtonStore, MAX_STORED_AGE, MAX_STORED_MESSAGES, buttonIndex, buttonRows, handleButtonClick } from "../dist/buttons.js";

const clearButtons = [
  { label: "Clear", text: "/clear", style: "danger" },
  { label: "Cancel", text: "/clear cancel" },
];

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "dc-buttons-"));
  const { store } = await ButtonStore.open(dir);
  return { dir, store };
}

function fakeCtx(language = "en") {
  const dispatched = [];
  return { ctx: { language, dispatch: (m) => dispatched.push(m) }, dispatched };
}

function fakeClick({ customId = "ob:0", userId = "u1", messageId = "m1", content = "Clear the session?" } = {}) {
  const calls = [];
  return {
    calls,
    click: {
      customId,
      channelId: "c1",
      guildId: "g1",
      user: { id: userId, username: "ada" },
      message: { id: messageId, content },
      update: async (o) => calls.push(["update", o]),
      reply: async (o) => calls.push(["reply", o]),
      followUp: async (o) => calls.push(["followUp", o]),
    },
  };
}

test("buttons fill rows of five with danger and secondary styles", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ label: `B${i}`, text: `t${i}` }));
  const rows = buttonRows([{ label: "Clear", text: "/clear", style: "danger" }, ...many]);
  assert.deepEqual(
    rows.map((r) => r.components.length),
    [5, 3],
  );
  assert.deepEqual(rows[0].components[0], { type: 2, style: 4, label: "Clear", custom_id: "ob:0" });
  assert.equal(rows[0].components[1].style, 2);
  assert.equal(rows[1].components[2].custom_id, "ob:7");
  assert.equal(buttonRows([{ label: "长".repeat(90), text: "x" }])[0].components[0].label.length, 80);
});

test("custom ids are parsed", () => {
  assert.equal(buttonIndex("ob:3"), 3);
  for (const id of ["", "ob:", "ob:x", "other"]) assert.equal(buttonIndex(id), undefined);
});

test("the store persists, prunes and survives a broken file", async () => {
  const { dir, store } = await openStore();
  const now = Date.now();
  await store.add("old", "u1", clearButtons, now - MAX_STORED_AGE - 1);
  await store.add("m1", "u1", clearButtons, now);
  assert.equal(store.get("old"), undefined);
  const reopened = (await ButtonStore.open(dir)).store;
  assert.deepEqual(reopened.get("m1").texts, ["/clear", "/clear cancel"]);
  for (let i = 0; i < MAX_STORED_MESSAGES; i++) store.add(`x${i}`, "u1", clearButtons, now);
  await store.add("last", "u1", clearButtons, now);
  assert.equal(store.size, MAX_STORED_MESSAGES);
  assert.equal(store.get("m1"), undefined);

  writeFileSync(join(dir, BUTTONS_FILE), "{broken");
  const { store: empty, problem } = await ButtonStore.open(dir);
  assert.ok(problem);
  assert.equal(empty.size, 0);
});

test("the owner's click sends the button text and closes the buttons", async () => {
  const { dir, store } = await openStore();
  await store.add("m1", "u1", clearButtons);
  const { ctx, dispatched } = fakeCtx("zh");
  const { click, calls } = fakeClick({ customId: "ob:1" });
  let typed = false;
  await handleButtonClick(ctx, store, click, () => (typed = true));

  assert.deepEqual(calls, [["update", { content: "Clear the session?\n\n✓ 已选择：Cancel", components: [] }]]);
  assert.equal(dispatched.length, 1);
  const { time, ...inbound } = dispatched[0];
  assert.ok(time > 0);
  assert.deepEqual(inbound, {
    chat_id: "c1",
    sender_id: "u1",
    message_id: "m1",
    text: "/clear cancel",
    raw: JSON.stringify({ channel_id: "c1", message_id: "m1" }),
    context: { guild_id: "g1", channel_id: "c1", author_name: "ada" },
  });
  assert.ok(typed);
  assert.equal(store.get("m1"), undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, BUTTONS_FILE), "utf8")), {});
});

test("a long message only loses its buttons", async () => {
  const { store } = await openStore();
  await store.add("m1", "u1", clearButtons);
  const { ctx } = fakeCtx();
  const { click, calls } = fakeClick({ content: "a".repeat(1995) });
  await handleButtonClick(ctx, store, click);
  assert.deepEqual(calls, [["update", { components: [] }]]);
});

test("someone else's click is refused", async () => {
  const { store } = await openStore();
  await store.add("m1", "u1", clearButtons);
  const { ctx, dispatched } = fakeCtx();
  const { click, calls } = fakeClick({ userId: "u2" });
  await handleButtonClick(ctx, store, click);
  assert.deepEqual(calls, [["reply", { content: "Only the person who asked can choose", ephemeral: true }]]);
  assert.equal(dispatched.length, 0);
  assert.ok(store.get("m1"));
});

test("unknown buttons expire", async () => {
  const { store } = await openStore();
  const { ctx, dispatched } = fakeCtx();
  const { click, calls } = fakeClick();
  await handleButtonClick(ctx, store, click);
  assert.deepEqual(calls, [
    ["update", { components: [] }],
    ["followUp", { content: "This button has expired", ephemeral: true }],
  ]);
  assert.equal(dispatched.length, 0);

  const other = fakeClick({ customId: "something-else" });
  await handleButtonClick(ctx, store, other.click);
  assert.deepEqual(other.calls, []);
});
