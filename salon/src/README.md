# salon/src/ — esquisse d'origine, **non déployée**

Ce dossier contient la maquette TypeScript d'origine du Salon (composants, textes,
logique d'essai). **Rien de ce dossier n'est construit ni servi** : le Salon publié
est le dossier [`backend/web/public/salon/`](../../backend/web/public/salon/)
(copilé vers `deploy/salon` par la CI).

Ce qui vit encore ici (lu par des scripts et des tests, ne pas déplacer sans mise à jour) :

- `lib/salon/catalog.json` — catalogue des 54 auteurs (œuvres, URLs Gutenberg/domaine public) ;
  lu par `salon/scripts/harvest_corpus.mjs`, `salon/scripts/kb_export.mjs`, `tests/salon-copy`, `tests/salon-i18n`, `tests/salon-doctrine`.
- `lib/salon/doctrine.json` — doctrine (thèses fr/en, ancres, concepts) ; copie publiée
  `backend/web/public/salon/doctrine.json` — les deux fichiers doivent rester identiques.
- `lib/salon/corpus.json` — ancien corpus d'alignement (voir `salon/scripts/align_corpus.mjs`).
- `lib/salon/i18n.ts`, `Foyer.tsx`, `Chrome.tsx` — textes de référence lus par `tests/salon-copy`.

Le reste (composants, wasm, etc.) est conservé comme histoire du projet : ne pas s'en servir
comme source de vérité pour le client publié.

Voir aussi : `docs/SALON-OPENKB.md`, `docs/SALON.md`.
