# Archive

Documents et outils **historiques**, conservés pour mémoire. Rien ici n'est déployé,
testé ni référencé par les workflows (`.github/workflows/*`, `deploy/ovh-vps/assemble-www.sh`).

| Dossier | Contenu | Remplacé par |
|---|---|---|
| `specs/` | Spécifications fonctionnelles/techniques v0.3 (juillet–août 2026), connecteurs chat, analyse d'écarts Brightidea | `docs/CAHIER-DES-CHARGES-CONSOLE.md` (console, à jour au 6 oct. 2026), `docs/PRODUCTION-CONSOLE-V2.md`, `docs/CONSOLE-HYBRID-AGENTS.md` |
| `docs/` | Notes d'itération v13/v14 (Slack · ontologie), proposition de simplification du site (18 août) | `CHANGELOG.md`, landing actuelle (PR #43/#44) |
| `design-restyle/` | Audit et guide de style du restyle d'août + scripts one-shot (captures PowerShell/Chrome, restyle, contrôle d'overflow) | Les pages restylées elles-mêmes (`*.html`, `tokens.css`, `site.css`) |

Les captures d'écran du restyle (`DELIVERY/screenshots/`, ~15 Mo) et les scripts de patch
ponctuels (`scripts/patches/`, `scripts/apply-*.ps1`) ont été supprimés : ils restent
accessibles dans l'historique git (commit antérieur à la PR de nettoyage).
