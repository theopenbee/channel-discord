# openbee Discord channel

A minimal Discord channel for openbee, built on [`@theopenbee/channel-sdk`](https://www.npmjs.com/package/@theopenbee/channel-sdk). It also serves as a reference implementation of the [channel plugin protocol](https://github.com/theopenbee/openbee/blob/main/docs/channel-plugin-protocol.md).

## Behaviour

- Direct messages are always handled. In servers the bot only answers when it is @mentioned (replying to the bot counts as a mention).
- `allowed_guilds` limits which servers the bot listens to; leave it empty to allow all.
- One openbee session per channel and user (`discord:<channel_id>:<user_id>`). Threads are channels in Discord, so each thread gets its own session.
- Inbound attachments up to `max_media_size` bytes are downloaded into openbee's media directory; larger ones are replaced by a `[attachment too large: <name>]` note.
- Replies longer than 2000 characters are split into several messages, preferring line breaks. Text is sent first, then the file. Outgoing messages never ping `@everyone`, roles or users.
- Messages with buttons (the `/clear` confirmation, choices offered by a worker or Bee, `/status`, `/engine`, `/cancel`) get Discord buttons. Only the user the message answers can click; the click counts as their reply, and the buttons are replaced by the choice. Buttons are kept in the plugin data directory for 90 days, so they still work after a restart. Clicks arrive over the gateway, so leave **Interactions Endpoint URL** empty in the Developer Portal.

## Create the bot

1. Open <https://discord.com/developers/applications> and create a **New Application**.
2. **Bot** → **Reset Token** and copy the token. On the same page enable **MESSAGE CONTENT INTENT**.
3. **OAuth2** → **URL Generator**: scope `bot`; permissions **View Channels**, **Send Messages**, **Read Message History**, **Attach Files**. Open the generated URL and add the bot to your server.

## Install

Install it from **Settings → Plugins → Marketplace**, or run:

```sh
openbee plugin install @theopenbee/channel-discord
```

Or from a local checkout:

```sh
git clone https://github.com/theopenbee/channel-discord.git
cd channel-discord
npm install
openbee plugin install "$(pwd)"
```

Then fill in its settings and enable it under **Settings → Plugins** in the desktop app or the web console, or run `openbee plugin configure discord`. Setup guide: https://theopenbee.com/docs/chat-apps/discord/

Settings, also accepted as `openbee plugin configure discord --set key=value`:

| Key | Default | |
|---|---|---|
| `token` | | Bot token. Required. |
| `allowed_guilds` | empty | Server IDs to answer in; empty allows all. DMs are always handled. |
| `max_media_size` | `10485760` | Largest incoming attachment, in bytes. |

## Development

```sh
npm install
npm test
```

`npm install` also builds `dist/`; run `npm run build` after changing `src/`.
