# Intégrations KayrosLab

Brancher la console KayrosLab sur les outils de l'entreprise via l'**API publique v1** (`/v1/public`, documentation : https://api.kayroslab.com/docs).

| Dossier | Contenu |
|---------|---------|
| [`n8n/`](n8n/README.md) | **PoC Salesforce en 15 minutes** avec n8n auto-hébergé sur le VPS (recommandé) |
| [`zapier/`](zapier/README.md) | Même scénario avec 2 Zaps |

Référence de l'API et des webhooks : [`docs/API.md`](../docs/API.md) · Architecture : [`docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md`](../docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md) · Exploitation : `RUNBOOK.md` § Intégrations.

## Chat connectors

Native Slack / Microsoft Teams / Discord connectors (async replies, arbitration buttons): setup and secrets in
[docs/CHAT-CONNECTORS-SETUP.md](../docs/CHAT-CONNECTORS-SETUP.md) · Teams app package: [teams/](teams/README.md) ·
Discord command registration: [discord/](discord/README.md).
