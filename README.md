# openbee Discord channel

A minimal Discord channel for openbee, built on [`@theopenbee/channel-sdk`](https://www.npmjs.com/package/@theopenbee/channel-sdk). It also serves as a reference implementation of the [channel plugin protocol](https://github.com/theopenbee/openbee/blob/main/docs/channel-plugin-protocol.md).

## Behaviour

- Direct messages are always handled. In servers the bot only answers when it is @mentioned (replying to the bot counts as a mention).
- `allowed_guilds` limits which servers the bot listens to; leave it empty to allow all.
- One openbee session per channel and user (`discord:<channel_id>:<user_id>`). Threads are channels in Discord, so each thread gets its own session.
- Inbound attachments up to `max_media_size` bytes are downloaded into openbee's media directory; larger ones are replaced by a `[attachment too large: <name>]` note.
- Replies longer than 2000 characters are split into several messages, preferring line breaks. Text is sent first, then the file. Outgoing messages never ping `@everyone`, roles or users.

## Create the bot

1. Open <https://discord.com/developers/applications> and create a **New Application**.
2. **Bot** → **Reset Token** and copy the token. On the same page enable **MESSAGE CONTENT INTENT**.
3. **OAuth2** → **URL Generator**: scope `bot`; permissions **View Channels**, **Send Messages**, **Read Message History**, **Attach Files**. Open the generated URL and add the bot to your server.

## Install

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

Then enable it with `openbee config`, or add it to `config.yaml` and restart openbee:

```yaml
bee:
  platforms:
    discord:
      enabled: true
      bot_name: OpenBee
      token: "<bot token>"
      allowed_guilds: []
```

## Development

```sh
npm install
npm test
```

`npm install` also builds `dist/`; run `npm run build` after changing `src/`.
