# `frontend/canvas-app` — Atelier d'idéation visuel

Application React du **canvas divergent** (lot v11 du [CDC](../../CDC_CANVAS_IDEATION.md)). Même stack que `positionning-app` : React 19 + Vite 6.

```bash
npm install
npm run dev      # http://localhost:5173, proxy /v1 -> localhost:8787
npm run build
```

## Le cœur est consommé tel quel

L'alias Vite `@core` pointe sur `../../core`. **Aucune logique métier n'est réimplémentée ici** : le clustering, les personas, les frameworks et la promotion viennent des modules ESM du cœur, exécutés dans le navigateur. Le frontend n'est qu'une surface.

C'est ce que permet la contrainte « zéro dépendance » du cœur — et c'est la raison pour laquelle il faut la tenir.

## Paliers de souveraineté

| Palier | Configuration | Comportement |
|---|---|---|
| **P0** | aucune | `MockProvider` + `MockEmbeddings`, hors ligne, rien ne sort |
| **P2** | `VITE_BACKEND_URL` | LLM et embeddings via le proxy ; **aucune clé côté client** |

## Abstraction du moteur de rendu

`src/renderer/CanvasRenderer.js` définit le contrat ; `ReactFlowRenderer.jsx` en est la seule implémentation et **le seul fichier autorisé à importer `@xyflow/react`**.

C'est la mitigation du risque **R1** du CDC : React Flow (SVG) plafonne vers 1 000–1 500 nœuds. Au-delà de `SEUIL_ALERTE_NOEUDS`, l'interface affiche un avertissement plutôt que de ramer en silence. La bascule vers Konva ou PixiJS est un remplacement de module, pas une réécriture.

## Ce que l'interface rend visible

Les exigences du CDC ne valent que si elles se voient à l'écran :

- **Sourçage (EF-201/207)** — pastille 🔗 sur une assertion sourcée, ⛓️‍💥 grisée quand la source a été retirée. Une assertion non étayée ne se déguise pas en assertion étayée.
- **Origine agent (EF-242, anticipé)** — pastille 🤖 sur toute production d'agent.
- **Désaccords (EF-231)** — les arêtes `contredit` sont rouges et animées. Le conflit se voit sans lire les étiquettes.
- **Nœuds figés (EF-218)** — pastille 📌, `draggable: false`.
- **Coût (EF-230)** — compteur de jetons et d'USD affiché *pendant* le swarm, avec le flux des sorties au fil de l'eau.
- **Quota (EF-209)** — le plafond est vérifié *avant* la lecture du fichier, pas après.
- **Non-évalué (EF-258)** — un nœud sans note affiche « Non évalué — aucun quadrant n'est supposé », jamais un quadrant par défaut.

## Deux modes, une seule interface

| Mode | Configuration | Comportement |
|---|---|---|
| **local** | aucune | Le cœur tourne dans le navigateur. Rien ne sort. Rechargement = perte. |
| **backend** | `VITE_BACKEND_URL` | Le serveur détient les données et les clés. Persistance réelle, jeton en session. |

Aucune logique métier n'est dupliquée entre les deux : en local le studio du cœur fait le travail, en distant le backend appelle **exactement le même code**.

Le contrat entre les deux est vérifié par `backend/fastify/tests/contrat-api.mjs` — 21 vérifications sur la forme des réponses. C'est le défaut classique d'une intégration : le backend renvoie `{data}` là où le front lit `.workspace`, et rien ne le signale avant le premier clic en production.

## Temps réel (EF-220/221/230)

En mode backend, l'application s'abonne au flux SSE de l'espace : les modifications des autres participants arrivent sans rechargement, la présence est affichée, et le swarm est **streamé** — chaque persona apparaît dès qu'elle répond, avec le coût cumulé, au lieu d'attendre les six.

La réconciliation d'un travail hors ligne pousse l'**état complet** et non une liste d'opérations : rejouer des opérations sur un état qui a changé entre-temps est la source classique de perte. La fusion appliquée côté client est **exactement celle du serveur** (`mergeWorkspaces` du cœur) — aucune règle de résolution n'est réimplémentée ici.

Vérifié par `backend/fastify/tests/temps-reel.mjs` : 20 vérifications avec deux clients simultanés.

## Limites connues

- Bundle de 488 kB (158 kB gzip) : `createEngine` tire l'ensemble du cœur, scanners *Positionner* compris. Un point d'entrée allégé est possible si le poids devient gênant.
- Deux personnes éditant **le même champ texte** en même temps tombent en dernier-écrivain-gagne. Le CRDT du cœur est un CRDT d'objets, pas de texte.
- La reconnexion est à intervalle croissant plafonné à 30 s : après une coupure longue, le retour n'est pas instantané.
