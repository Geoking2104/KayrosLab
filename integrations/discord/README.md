# Discord slash command registration

The server answers `/kayros question:<text>` (`backend/fastify/lib/chat-handlers.mjs`). Discord only shows the
command once it is registered for the application:

```bash
DISCORD_APPLICATION_ID=<application id> DISCORD_BOT_TOKEN=<bot token> \
node integrations/discord/register-commands.mjs            # global command (propagation up to ~1 h)

DISCORD_GUILD_ID=<server id> ...                            # instant, one server (testing)
node integrations/discord/register-commands.mjs --dry-run   # print the payload, no API call
```

The call is a `PUT` (bulk overwrite): running it again is safe and replaces the previous definition. The token is
read from the environment only, never printed or written to disk. Interactions Endpoint URL and the other
platform-side steps: [docs/CHAT-CONNECTORS-SETUP.md](../../docs/CHAT-CONNECTORS-SETUP.md).
