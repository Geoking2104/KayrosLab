# Microsoft Teams app package

`app-package/manifest.template.json` (Teams manifest v1.17) and its icons (`color.png` 192×192,
`outline.png` 32×32) produce the package that a Teams admin uploads so users can talk to the KayrosLab bot.

```bash
TEAMS_APP_ID=<Microsoft App ID of the Azure Bot> \
KAYROS_PUBLIC_API_URL=https://api.kayroslab.com \
node integrations/teams/build-app-package.mjs            # → integrations/teams/dist/kayroslab-teams.zip
```

Optional: `TEAMS_MANIFEST_ID` (GUID of the Teams app, defaults to `TEAMS_APP_ID`), `APP_VERSION` (default `1.0.0`;
bump it for every re-upload). Only the public App ID goes into the package — never `TEAMS_BOT_PASSWORD`.

Upload: Teams → *Apps → Manage your apps → Upload an app* (sideloading allowed), or Teams Admin Center →
*Teams apps → Manage apps → Upload new app* for the whole tenant. Then add the app to a team or chat and bind the
channel to a collective. Bot scopes: `personal` (send `lier` to link your KayrosLab account), `team`, `groupChat`.
Server-side configuration: [docs/CHAT-CONNECTORS-SETUP.md](../../docs/CHAT-CONNECTORS-SETUP.md).
