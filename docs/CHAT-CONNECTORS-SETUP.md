# Chat connectors — production setup (Slack · Microsoft Teams · Discord)

Status of the code on `main`: questions asked in a connected channel are **acknowledged at once** and the
collective runs in the background (same mechanism as console missions, Postgres mission queue when enabled).
The verdict is then posted in the originating channel with the **arbitration buttons of the console**; a failure
posts a readable error message. See the README section *Chat connectors* for the capability matrix.

## 1. How it behaves

| Step | Slack | Microsoft Teams | Discord |
|---|---|---|---|
| Ack | HTTP 200 (< 3 s), then « ⏳ Le collectif Kayros analyse… » posted in the message thread | HTTP 200, typing indicator, then « ⏳ … » as a reply to the activity (Bot Framework connector API, `serviceUrl` of the activity) | Deferred response `type 5` (« KayrosLab réfléchit… ») |
| Verdict | `chat.update` of the « ⏳ » message | `PUT` of the « ⏳ » activity with an Adaptive Card | `PATCH /webhooks/{app}/{token}/messages/@original` (token valid 15 min, then a new bot message in the channel) |
| Failure | « ⚠️ La mission n’a pas abouti : <reason> » in the same message | same | same |
| Arbitration | Buttons; *Réviser* and *Passer sous conditions* open a reason modal (`views.open`) | `Action.Submit` buttons + « Motif » field in the card | Buttons; reason via modal (`type 9`); message updated in place (`type 7`) |
| Retries / double clicks | message id claimed once; second click → « Décision déjà enregistrée » | activity id | interaction id |

Arbitration buttons map 1:1 to the console decisions (`POST /v1/console/threads/:id/arbitrate`):

| Chat button | Console action | Reason |
|---|---|---|
| **Approuver** (GO / CONDITIONAL GO) or **Refuser** (NO GO) | `accept_consensus` — accepts the collective's verdict | optional |
| **Réviser** | `reevaluate` | required (≥ 3 chars) |
| **Passer sous conditions** | `override_veto` with `decision: CONDITIONAL_GO` | required |

A dedicated "reject a GO" action does not exist in the console either; it was not invented for chat.

**Who may click:** the chat user must be **linked** to a KayrosLab account of the mission's tenant whose
**current** role is `comex` or `admin` (re-read from the user store at click time), and the click must come from
the channel where the mission was asked. An unlinked user receives a private single-use token (15 min):
console → **Réglages → Lier un compte chat**. On Teams, send `lier` to the bot in a personal chat (a token is never
shown in a shared channel). A decision taken in the console updates the chat card too.

## 2. GitHub secrets and variables to add

Repository → *Settings → Secrets and variables → Actions*. The deploy workflow writes a value to the server
`.env` **only if it is set**; an absent secret keeps whatever is already on the server (nothing is wiped).
Nothing below has a default value in the repository — no value is invented.

### Slack

| Name | Kind | Needed for | Where to get it |
|---|---|---|---|
| `SLACK_SIGNING_SECRET` | secret | every Slack mode with the server app (signature check) | api.slack.com/apps → your app → *Basic Information → App Credentials → Signing Secret* |
| `SLACK_CLIENT_ID` | secret | one-click connect (OAuth v2) | same page → *Client ID* |
| `SLACK_CLIENT_SECRET` | secret | one-click connect | same page → *Client Secret* |
| `SLACK_BOT_TOKEN` | secret | single-workspace server app (optional with one-click: each workspace gets its own encrypted token) | *OAuth & Permissions → Bot User OAuth Token* (`xoxb-…`) after installing the app |
| `SLACK_WEBHOOK_URL` | secret | optional, governance-gate notifications | *Incoming Webhooks* |
| `SLACK_OAUTH_SCOPES` | variable | optional (default `app_mentions:read,chat:write,commands,im:history,channels:history,groups:history`) | — |
| `SLACK_GATE_CHANNEL` | variable | optional, channel of governance-gate cards | channel id `C…` |

### Microsoft Teams

| Name | Kind | Needed for | Where to get it |
|---|---|---|---|
| `TEAMS_APP_ID` | secret | everything Teams (JWT audience, proactive replies, admin consent) | Azure portal → *Azure Bot* resource → *Configuration → Microsoft App ID* |
| `TEAMS_BOT_PASSWORD` | secret | everything Teams | Azure portal → the bot's App registration → *Certificates & secrets → New client secret* (value, shown once) |
| `TEAMS_WEBHOOK_URL` | secret | optional, governance-gate notifications | Teams channel → *Workflows / Incoming webhook* |
| `TEAMS_OAUTH_TENANT` | variable | optional (default `organizations`) | Azure AD tenant id or `organizations` |
| `TEAMS_GATE_CHANNEL` | variable | optional | conversation id |

### Discord

| Name | Kind | Needed for | Where to get it |
|---|---|---|---|
| `DISCORD_APPLICATION_ID` | secret | everything Discord | discord.com/developers/applications → your app → *General Information → Application ID* |
| `DISCORD_PUBLIC_KEY` | secret | signature check (Ed25519) | same page → *Public Key* |
| `DISCORD_BOT_TOKEN` | secret | invite mode, replies after 15 min, command registration | *Bot → Reset Token* |
| `DISCORD_CLIENT_ID` | secret | optional (defaults to `DISCORD_APPLICATION_ID`) | *OAuth2 → Client ID* |
| `DISCORD_CLIENT_SECRET` | secret | optional | *OAuth2 → Client Secret* |
| `DISCORD_WEBHOOK_URL` | secret | optional, governance-gate notifications | channel → *Integrations → Webhooks* |
| `DISCORD_INVITE_PERMISSIONS` | variable | optional (default `534723950656`) | — |
| `DISCORD_OAUTH_SCOPES` | variable | optional (default `bot applications.commands`) | — |
| `DISCORD_GATE_CHANNEL` | variable | optional | channel id |

Already required for every connector (present in the workflow before this change): `KAYROS_CONNECTOR_ENCRYPTION_KEY`
(secret) and `KAYROS_PUBLIC_API_URL=https://api.kayroslab.com` in the server `.env`.

One-click connect is offered by the console as soon as: Slack → `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET`
(+ `SLACK_SIGNING_SECRET`); Teams → `TEAMS_APP_ID` + `TEAMS_BOT_PASSWORD`; Discord → `DISCORD_APPLICATION_ID`
(or `DISCORD_CLIENT_ID`) + `DISCORD_BOT_TOKEN` + `DISCORD_PUBLIC_KEY`. Re-run the *Deploy KayrosLab backend*
workflow (`workflow_dispatch`) after adding secrets.

## 3. Platform-side manual steps

Base URL `https://api.kayroslab.com`.

**Slack app** (server app / one-click installs):
1. *OAuth & Permissions*: redirect URL `…/v1/connectors/slack/oauth/callback`; bot scopes as above.
2. *Event Subscriptions*: Request URL `…/v1/connectors/slack/events`; bot events `app_mention`, `message.im`.
3. *Interactivity & Shortcuts*: **On**, Request URL `…/v1/connectors/slack/interactive` (buttons and the reason modal).
4. *Slash Commands* (optional): `/kayros`, Request URL `…/v1/connectors/slack/interactive`.
5. *Manage Distribution* → public distribution if several workspaces will use one-click connect.

A workspace configured **manually** in console → Réglages uses its own app: put the connection's webhook URL
(`…/v1/connectors/slack/configured/<connection_id>`, shown in the console) in Event Subscriptions,
Interactivity **and** the slash command.

**Microsoft Teams:**
1. Azure Bot → *Configuration → Messaging endpoint* `…/v1/connectors/teams/interactive` (or the connection's
   webhook URL for a manual connection); *Channels → Microsoft Teams* enabled.
2. App registration → *Authentication*: redirect `…/v1/connectors/teams/oauth/callback` (admin consent).
3. Build the app package: `TEAMS_APP_ID=<app id> node integrations/teams/build-app-package.mjs` →
   `integrations/teams/dist/kayroslab-teams.zip`; upload it in Teams (*Apps → Manage your apps → Upload an app*)
   or in the Teams Admin Center for the whole tenant. See [integrations/teams/README.md](../integrations/teams/README.md).

**Discord:**
1. *General Information → Interactions Endpoint URL* `…/v1/connectors/discord/interactive` (Discord sends a signed
   PING: `DISCORD_PUBLIC_KEY` must already be deployed), or the connection's webhook URL for a manual connection.
2. *OAuth2 → Redirects*: `…/v1/connectors/discord/oauth/callback`.
3. Register the command once: `DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… node integrations/discord/register-commands.mjs`
   (add `DISCORD_GUILD_ID=…` for an instant per-server command while testing). See
   [integrations/discord/README.md](../integrations/discord/README.md).

**Every platform:** bind the channel to a collective (room) — `/kayros` in Slack/Discord or a mention in Teams
only works in a connected channel — and have each arbiter link their chat account (section 1).
