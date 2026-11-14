import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Button, ChannelContext, InboundMessage } from "@theopenbee/channel-sdk";

import { DISCORD_MESSAGE_LIMIT, encodeRaw } from "./helpers.js";

export const BUTTONS_FILE = "buttons.json";
export const MAX_STORED_MESSAGES = 1000;
export const MAX_STORED_AGE = 90 * 24 * 60 * 60 * 1000;
const ID_PREFIX = "ob:";
const BUTTONS_PER_ROW = 5;
const MAX_LABEL = 80;
const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const DANGER = 4;

export interface StoredButtons {
  scope: string;
  labels: string[];
  texts: string[];
  at: number;
}

function isStored(value: unknown): value is StoredButtons {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.scope === "string" &&
    typeof v.at === "number" &&
    Array.isArray(v.labels) &&
    Array.isArray(v.texts) &&
    v.labels.every((l) => typeof l === "string") &&
    v.texts.every((t) => typeof t === "string")
  );
}

export class ButtonStore {
  private readonly entries = new Map<string, StoredButtons>();
  private writing: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string) {}

  static async open(dataDir: string): Promise<{ store: ButtonStore; problem?: string }> {
    const store = new ButtonStore(join(dataDir, BUTTONS_FILE));
    let data: string;
    try {
      data = await readFile(store.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { store };
      return { store, problem: err instanceof Error ? err.message : String(err) };
    }
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== "object" || parsed === null) throw new Error(`${store.path} must contain a JSON object`);
      for (const [key, value] of Object.entries(parsed)) if (isStored(value)) store.entries.set(key, value);
    } catch (err) {
      return { store, problem: err instanceof Error ? err.message : String(err) };
    }
    return { store };
  }

  get size(): number {
    return this.entries.size;
  }

  get(messageId: string): StoredButtons | undefined {
    return this.entries.get(messageId);
  }

  add(messageId: string, scope: string, buttons: Button[], now = Date.now()): Promise<void> {
    this.entries.set(messageId, { scope, labels: buttons.map((b) => b.label), texts: buttons.map((b) => b.text), at: now });
    for (const [key, entry] of this.entries) {
      if (now - entry.at > MAX_STORED_AGE) this.entries.delete(key);
    }
    while (this.entries.size > MAX_STORED_MESSAGES) this.entries.delete(this.entries.keys().next().value!);
    return this.save();
  }

  remove(messageId: string): Promise<void> {
    if (!this.entries.delete(messageId)) return Promise.resolve();
    return this.save();
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(Object.fromEntries(this.entries));
    const tmp = `${this.path}.tmp`;
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(join(this.path, ".."), { recursive: true });
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, this.path);
      });
    return this.writing;
  }
}

export interface ButtonComponent {
  type: typeof BUTTON;
  style: typeof SECONDARY | typeof DANGER;
  label: string;
  custom_id: string;
}

export interface ActionRow {
  type: typeof ACTION_ROW;
  components: ButtonComponent[];
}

export function buttonRows(buttons: Button[]): ActionRow[] {
  const keys: ButtonComponent[] = buttons.map((b, i) => ({
    type: BUTTON,
    style: b.style === "danger" ? DANGER : SECONDARY,
    label: [...b.label].slice(0, MAX_LABEL).join(""),
    custom_id: ID_PREFIX + i,
  }));
  const rows: ActionRow[] = [];
  for (let i = 0; i < keys.length; i += BUTTONS_PER_ROW) rows.push({ type: ACTION_ROW, components: keys.slice(i, i + BUTTONS_PER_ROW) });
  return rows;
}

export function buttonIndex(customId: string): number | undefined {
  if (!customId.startsWith(ID_PREFIX)) return undefined;
  const rest = customId.slice(ID_PREFIX.length);
  return /^\d+$/.test(rest) ? Number(rest) : undefined;
}

export function selectedNote(language: string, label: string): string {
  return language === "zh" ? `✓ 已选择：${label}` : `✓ Selected: ${label}`;
}

export function notOwnerText(language: string): string {
  return language === "zh" ? "只有发起人可以选择" : "Only the person who asked can choose";
}

export function expiredText(language: string): string {
  return language === "zh" ? "这个按钮已失效" : "This button has expired";
}

export interface ButtonClick {
  customId: string;
  channelId: string;
  guildId: string | null;
  user: { id: string; username: string };
  message: { id: string; content: string };
  update(options: { content?: string; components: [] }): Promise<unknown>;
  reply(options: { content: string; ephemeral: true }): Promise<unknown>;
  followUp(options: { content: string; ephemeral: true }): Promise<unknown>;
}

export async function handleButtonClick(ctx: ChannelContext, store: ButtonStore, click: ButtonClick, onDispatch?: () => void): Promise<void> {
  const index = buttonIndex(click.customId);
  if (index === undefined) return;
  const entry = store.get(click.message.id);
  const text = entry?.texts[index];
  if (!entry || !text) {
    await click.update({ components: [] });
    await click.followUp({ content: expiredText(ctx.language), ephemeral: true });
    return;
  }
  if (entry.scope !== click.user.id) {
    await click.reply({ content: notOwnerText(ctx.language), ephemeral: true });
    return;
  }
  await store.remove(click.message.id);
  const note = selectedNote(ctx.language, entry.labels[index] ?? text);
  const content = click.message.content ? `${click.message.content}\n\n${note}` : note;
  await click.update(content.length <= DISCORD_MESSAGE_LIMIT ? { content, components: [] } : { components: [] });
  const inbound: InboundMessage = {
    chat_id: click.channelId,
    sender_id: click.user.id,
    message_id: `button:${click.message.id}`,
    text,
    raw: encodeRaw({ channel_id: click.channelId, message_id: click.message.id }),
    context: { guild_id: click.guildId ?? "", channel_id: click.channelId, author_name: click.user.username },
    time: Date.now(),
  };
  ctx.dispatch(inbound);
  onDispatch?.();
}
