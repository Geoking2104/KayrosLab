# Changelog

## v0.25.24 (2026-09) — Conversions GA4

- `dataLayer` : `generate_lead` (contact), `demo_start` (démo), `login` (SSO).
- Import GTM : `legal/gtm-ga4-conversions.json` (Google tag + 3 événements).
- À coller dans la variable **GA4 Measurement ID**, puis publier, puis marquer les conversions dans GA4.

## v0.25.23 (2026-09) — Google Tag Manager

- Conteneur `GTM-TXNT5J6M` en tête et `noscript` dans le corps (accueil, Salon, mentions).
- Consent Mode : mesure refusée tant que c15t n’accorde pas la catégorie.

## v0.25.22 (2026-09) — Erreurs du formulaire contact

- Validation côté table : nom, courriel, message, pièces (nombre, poids, type).
- L’API renvoie un `code` (INVALID, FILE, RATE, SMTP, SMTP_UNCONFIGURED).
- L’échec ne se fait plus passer pour un envoi : message distinct, `mailto:` en recours.

## v0.25.21 (2026-09) — Navigation, fiches, contact

- Un auteur (table, fil, cartes) ouvre sa fiche (`#fiche/voltaire`).
- Plus de 404 : Académie, Pouvoir, Lumières, Contact redirigent vers le Salon.
- Contact : le volet s’ouvre ; si le SMTP n’est pas armé, la lettre part en `mailto:`.

## v0.25.20 (2026-09) — `#agents` ouvre les auteurs

- Le script mourait sur `salonUser` avant d’avoir lu le hash : le volet restait caché.
- Lien « Auteurs » : `/salon/#agents`. Filet CSS `:target` si le JS rate.

## v0.25.19 (2026-09) — SMTP via Gmail

- `contact@kayroslab.com` est une redirection IONOS, pas une boîte d’envoi.
- Relais : `smtp.gmail.com`, compte Gmail. Destination publique inchangée (IONOS redirige).
- Secret : mot de passe d’application Google (`KAYROS_SMTP_PASS`).

## v0.25.18 (2026-09) — SMTP IONOS

- Courrier sortant via `smtp.ionos.fr` (boîte `contact@kayroslab.com`), déjà autorisée par le SPF.
- Secret unique : `KAYROS_SMTP_PASS`. Contact, rapports, reset de mot de passe, Authelia.
- `/health` indique si le relais est armé, sans exposer le secret.

## v0.25.17 (2026-09) — Mentions, cookies, CGU, contact

- Pied de Salon : mentions légales, cookies (c15t), conditions générales, onglet Contact.
- SASU KayrosLab en cours de formation, 36 rue de l’abbé Groult, 75015 Paris — Geoffroy de La Tournelle.
- Lettre et signalement (pièces jointes) vers contact@kayroslab.com.

## v0.25.16 (2026-09) — Salon : SSO, mémoire, anglais sans français

- Entrer / Partir : OpenID (Authelia), même client que la console, `redirect_uri` `/salon/`.
- `GET` / `PUT /v1/salon/state` : cercles et tours de parole liés au compte ; l’invité reste dans le navigateur.
- Anglais : fil spécimen, cercles-semence, fiches, « à » / “to”, plus de Lumières ni de question française une fois EN choisi.

## v0.25.15 (2026-09) — Salon : mémoires vérifiées, livres de l’auteur

- Chaque œuvre Gutenberg a été relue sur la ligne `Author:` (ou le titre pour les écritures).
- Plus de Proclus chez Platon, d’Expositor’s Bible chez Smith, d’Imitation chez le christianisme, ni d’Évangile de Bouddha.
- Cinq livres distincts quand ils existent ; sinon la mémoire reste mince (Marc Aurèle, Sun Tzu, le Coran…).
- Épicure : lettres et maximes tirées du livre X de Diogène Laërce.

## v0.25.14 (2026-09) — Salon : portrait pour chaque auteur

- 48 portraits (Wikimedia) ; 6 pictogrammes de tradition.
- Plus d’initiales à la place d’un visage.

## v0.25.13 (2026-09) — Salon : fiches auteurs plus légères


- Catalogue : portrait, nom, @, ère, blurb (2 lignes), nombre d’œuvres.
- Plus de liste d’ouvrages ni bouton redondant. Images `lazy`, recherche 120 ms.

## v0.25.12 (2026-09) — Salon : page Auteurs restaurée


- `#agents` affiche le catalogue (54 fiches, recherche, ajout, configuration).
- Le script ne plante plus (`esc`, `renderAgents`).

## v0.25.11 (2026-09) — Salon : grilles nommées


- Cercles, fil et convives : `grid-template-areas`.
- `auto-fit` + `minmax(0, 1fr)` : plus de colonne qui écrase le texte.

## v0.25.10 (2026-09) — Salon : 404 auteurs, titre EN, bloc cercle


- `/salon/agents/` ne 404 plus (Pages + hash `#agents`).
- Liste des cercles : plus de colonne `auto` qui écrase la question.
- Titre EN : *They put on the skin of a book.*

## v0.25.9 (2026-09) — Salon : 54 auteurs, i18n EN complète


- Onglet Auteurs : les 54 fiches, plus seulement six.
- Noms, ères et résumés en anglais (Aristote → Aristotle, etc.).
- Cercles : Lumières / Enlightenment, question de table traduite.

## v0.25.8 (2026-09) — Salon : cases à cocher


- Cases à taille fixe, nom sur une ligne, ellipsis. Plus de carrés qui s’étirent.

## v0.25.7 (2026-09) — Salon : responsive


- Paddings `clamp`, safe-area, grilles `minmax(min(…, 100%), 1fr)`.
- Breakpoints 479 / 719 / 1100. Plus de débordement à 320 px.

## v0.25.6 (2026-09) — Salon : « Les auteurs », i18n EN


- Plus de « 28 fiches » : le titre est **Les auteurs** / **The authors**.
- Chrome du spécimen (fiche, méthode, convives, envoi) passé par i18n EN.

## v0.25.5 (2026-09) — Salon : Gutenberg, Atramenta, traditions


- « Ajouter une œuvre » : plus de « Chercher au domaine public ». Recherche Gutenberg + Atramenta.
- Catalogue : 54 convives. Shakespeare conservé ; 20 philosophes ajoutés ; Bible, Torah, Coran, Gîtâ, Dhammapada, Tao-Tö-King (symboles en portrait).
- Mémoires puisées sur Project Gutenberg (Atramenta à l’ajout d’œuvre, quand le catalogue répond).

## v0.25.4 (2026-09) — Salon : copie, convier, i18n


- Cercle : « tout le monde écoute ». Pied : ils répondent aux livres, entre eux, et à vous.
- Ouvrir un cercle : libellés une seule fois ; compteur d’invités dynamique ; **Convier**.
- **Configurer la personnalité.** **Ajouter un auteur.** Plus de plafond 6.
- Anglais relu (calques, pluriels, Authors / Invite / Profile).

## v0.25.3 (2026-09) — SSO OpenID Connect auto-hébergé


- **Plus d’Auth0.** Client OIDC générique (découverte `.well-known`, PKCE). Tout IdP ouvert (Authelia, Keycloak, Dex, Authentik) peut prendre la place.
- **Authelia 4.39** (Apache-2.0) sur le VPS, `sso.kayroslab.com`. Compte initial dans `/opt/kayroslab/data/authelia/INITIAL_PASSWORD.txt`.
- Console : **Continuer avec SSO**. Voir `docs/SSO.md`.

## v0.25.2 (2026-09) — SSO Auth0 sur la console


- **Continuer avec SSO.** Universal Login du tenant `dev-1mveynszu4lngakl` (PKCE). Le backend vérifie l’`id_token` (JWKS) et émet le jeton KayrosLab.
- Compte `contributeur` créé à la première visite, ou relais par e-mail d’un compte déjà inscrit.
- Secrets `AUTH0_CLIENT_ID` (et optionnels `AUTH0_DOMAIN`, `AUTH0_CLIENT_SECRET`). Voir `docs/AUTH0.md`.

## v0.25.1 (2026-09) — Site statique sur le VPS (nginx)


- **`www.kayroslab.com`** — vhost nginx (`deploy/ovh-vps/nginx-kayroslab-www.conf`) : accueil, `/salon/`, `/console/`, WASM. ACME sur le 80, HTTPS dès que le certificat existe.
- **`deploy-www.sh`** assemble `/var/www/kayroslab` et recharge nginx. Appelé en fin de `deploy-backend.sh`.
- **SSL** — workflow `setup-ssl-www.yml` (dispatch), après le DNS A vers `51.210.9.71`.

## v0.25.0 (2026-09) — Salon, les auteurs prennent la peau d’un livre


- **Agents, pas protocole.** Vingt-huit auteurs du domaine public (cinq œuvres parsées chacun). Le moteur prend la peau d’un agent et répond dans le cercle ; les agents se parlent, ou l’hôte les appelle par `@`.
- **Fiches.** `@`, résumé, méthode (œuvre / rhétorique / elenchus), instruction de table. Ajout d’œuvres par Gutenberg, PDF ou TXT — à tous les agents.
- **Ajouter un agent.** Cinq œuvres libres au minimum. Moins de cinq : la profondeur de personnalité est trop faible.
- **Ouvrir un cercle.** 1. nom 2. question 3. invités, puis **Faire entrer**.
- **Conserver en PDF.** Couverture, page de garde des auteurs, index, fil.
- **FR / EN.** Interface bilingue. Les livres restent dans leur langue.
- **Pages `/salon/`** — spécimen HTML (Hallmark, oxblood) + source React (`salon/src`) + crate Rust (`crates/salon-core`). La console de production n’est pas touchée.

## v0.24.1 (2026-09) — Salon, le protocole WASM s’évalue vraiment

- Le chargeur lisait le retour de `salon_eval` comme un pointeur dans la mémoire linéaire alors que le crate renvoyait un **décalage dans le tas** (`OUT_OFF = 24576`). Le module s’instanciait, l’UI disait Rust, l’évaluation tombait silencieusement en JavaScript.
- `salon_eval` retourne désormais le pointeur absolu (`heap + OUT_OFF`). Le JS lit toujours `salon_heap() + salon_out_off()`.
- Sonde au chargement (cercle vide → lecteur / lecture). Le fallback JS ne se fait plus passer pour Rust.

## v0.24.0 (2026-09) — Salon, produit autonome (cercles littéraires)

- **Salon n’est pas un salon Slack.** Nouveau service : cercles de lecture littéraires et philosophiques (rôles hôte / lecteur / objecteur / secrétaire / invité ; tours lecture → objection → défense → concession → synthèse → minute ; verdicts **tenir · relire · laisser**, jamais GO/NO_GO).
- **`crates/salon-core`** — protocole en Rust (`evaluate`, 4 tests hôtes). Compilé en `salon_core.wasm` (ABI C : `salon_heap`, `salon_eval`, `salon_out_off`). Fallback JS aux mêmes règles.
- **Pages `/salon/`** — foyer + séance Hallmark (Specimen / Newsprint / oxblood) dans `backend/web/public/salon/`. Lien depuis le pied de `index.html` et `index.fr.html`.
- **Console de production inchangée.** Cette livraison ne touche pas `frontend/console-app`. Ne pas fusionner un workbench par-dessus.

## v0.23.0 (2026-08) — Étape 3 · Construire (Collision Mode EF-06)


- **`core/collision.mjs`** (nouveau) — `distanceConcepts` (distance réelle par partage de tags, jaccard), `idCollision` (id stable par paire triée), `normalizeCollision` (2 concepts requis, faisabilité clampée 0–100), `scoreCollision` (**nouveauté × faisabilité / 100, `null` sans faisabilité**), `runCollisionMode` (paires ≥ plancher 60, ignore arêtes du réseau + historique déjà collisionné, tri par score, `generer()` importe proposition/faisabilité), `addCollision` (timeline append-only horodatée + signée, dédup), `rapportCollision` (comptages réels). La faisabilité est **importée** (LLM/humain), jamais devinée.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/collision` (concepts depuis body ou canvas/`cartographie.tendances`, plancher, `scores[]` d'apport, persiste `construire.collisions`, `construire.collision`), `GET .../collision` (rapport), `POST .../collision/selection` (mémorise `construire.selectionCollisions`, `construire.collision.select`).
- **Tests** — `core/collision.test.mjs` (8) + `backend/fastify/tests/portfolio.collision.test.mjs` (5).
- **Spécifications** — EF-06 🟢 implémenté (§4.5 TECHNIQUES, US-03 enrichi) ; Étape 3 Construire désormais **🟢 définitive**.

## v0.22.0 (2026-08) — Étape 3 · Construire (canvas de scénario EF-05)

- **`core/construire.mjs`** (nouveau) — `canvasConstruire` (init depuis la sélection Cartographier F6 : noeuds/ponts/ts), `addScenario`/`updateScenario`/`removeScenario` (CRUD immuable, dédup par `idScenario`, re-normalisation au merge), `rapportConstruire` (comptages réels par type rupture/prudente/optimiste). Le moteur valide et aggrège ; le contenu reste fourni par l'utilisateur ou le Synthesizer LLM.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/scenarios/canvas` (init depuis `cartographie.selection`, `construire.canvas`), `GET .../scenarios` (rapport), `POST .../scenarios` (composer, `construire.add`), `PATCH .../scenarios/:scenarioId` (éditer, `construire.update`), `DELETE .../scenarios/:scenarioId` (retirer, `construire.remove`). État persisté sur `idea.construire`.
- **Tests** — `core/construire.test.mjs` (7) + `backend/fastify/tests/portfolio.construire.test.mjs` (6).
- **Spécifications** — EF-05 🟢 implémenté (§4.5 TECHNIQUES, US-03 enrichi).

## v0.21.0 (2026-08) — Étape 2 · Cartographier (réseau & ponts de bisociation, EF-03/EF-04)

- **`core/cartographier.mjs`** (nouveau) — `normalizeTendance`/`idTendance` (id stable → déduplication), `buildReseau` (nœuds + arêtes typées corrélation/causalité/opposition dédupliquées), `centralite` (pivots F3), `zonesTension` (F4), `horizonEffectif` court/moyen/long (F5, jamais deviné), `distanceClusters` (distance réelle par partage de tags), `dejaLie`, `suggestPonts` (EF-04 : paires distantes non reliées, nouveauté déterministe + justification), `scorePont` (nouveauté × plausibilité / 100, **`null` sans plausibilité**), `sendNetworkSelectionToScenario` (F6) et `rapportCartographie`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST/GET /v1/ideas/:id/tendances` (construction du réseau + rapport ; sans liste, depuis les signaux qualifiés d'Écouter ; événement `carto.build`), `POST .../tendances/ponts` (suggestions EF-04 + scoring sur plausibilité, `carto.ponts`), `POST .../tendances/selection` (payload → Construire F6, `carto.selection`).
- **Tests** — `core/cartographier.test.mjs` (11) + `backend/fastify/tests/portfolio.cartographier.test.mjs` (6).
- **Spécifications** — EF-03/EF-04 marqués 🟢 ; Étape 2 Cartographier désormais **🟢 définitive**.

## v0.20.0 (2026-08) — Étape 1 · Écouter (signaux faibles, EF-01/EF-02)

- **`core/ecouter.mjs`** (nouveau) — `normalizeSignal`/`idSignal` (id canonique → déduplication), `freshnessScore` (décroissance exponentielle déterministe, demi-vie 90 j), `scoreSignal` (note 0–100 pondérée : pertinence 50% · fraîcheur 25% · impact 25%, dimensions + raisons traçables), `reductionBruit` (masquage réversible) + `renderNoiseReduction`, `promoteSignal` (qualification horodatée + signée), `clusterSignals` (tags/source) et `rapportEcoute`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/signals` (ajout + score expliqué, événement `ecouter.add`), `GET /v1/ideas/:id/signals` (réduction + clusters), `POST .../signals/promote` (EF-01, `ecouter.promote`), `POST .../signals/noise` (seuil persisté).
- **Tests** — `core/ecouter.test.mjs` (10) + `backend/fastify/tests/portfolio.ecouter.test.mjs` (5).
- **Spécifications** — EF-01/EF-02 marqués 🟢 ; Étape 1 Écouter désormais **🟢 définitive**.

## v0.19.0 (2026-08) — Étape 5 · Arbitrer (synthèse COMEX + décision tracée EF-13/14)

- **`core/arbitrage.mjs`** (nouveau) — `recordDecision` (journal append-only Go/No-Go/Révision horodaté + signé, séquencé), `decisionsTimeline`, `lastDecision`, `buildSyntheseArbitrage` (dossier F1 composé de données réelles : recommandation WG, red flags de la matrice de risques, projection, gates en attente, journal).
- **`backend/fastify/routes/portfolio.mjs`** — `GET /v1/ideas/:id/arbitrage` (synthèse d'arbitrage F1) + `GET /v1/ideas/:id/decisions` (journal EF-14).
- **`backend/fastify/routes/gates.mjs`** — la résolution de gate (`POST /v1/gates/:gateId/resolve`) alimente désormais le journal `idea.decisions` (décision + auteur + rôle + motif + gateId + horodatage) en plus de l'audit `gate.resolved`.
- **Tests** — `core/arbitrage.test.mjs` (8) + `backend/fastify/tests/portfolio.arbitrage.test.mjs` (4).
- **Spécifications** — EF-13/EF-14 marqués 🟢 ; Étape 5 Arbitrer désormais **🟢 définitive**.

## v0.18.5 (2026-08) — EF-45 · Jalons de gouvernance futurs (gates COMEX datés)

- **`core/gates-futurs.mjs`** (nouveau) — `normalizeFuturGate`, `setGatesFuturs`, `gatesFutursStatus` (à venir / dus / matérialisés), `dueGates`, `materialiserGate`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST/GET /v1/ideas/:id/gates-futurs` (planification datée dans la roadmap) + `POST .../gates-futurs/materialise` (ouvre de vrais gates COMEX à échéance via GovernanceService, événements `gatesfuturs.plan|materialise`).
- **Tests** — `core/gates-futurs.test.mjs` (5) + `backend/fastify/tests/portfolio.gates-futurs.test.mjs` (3).
- **Spécifications** — EF-45 marqué 🟢 ; Étape 6 Projeter désormais **🟢 définitive** (EF-39→45 tous implémentés).

## v0.18.4 (2026-08) — EF-44 · Capitalisation No-Go

- **`core/capitalisation.mjs`** (nouveau) — `buildCapitalisation` (dossier structuré : apprentissages, conditions de réactivation, signaux), `addApprentissage`, `reactivationReady` (conditions satisfaites face aux signaux constatés), `resumeCapitalisation`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/capitalisation` (réservé aux idées `non_poursuivi`, persistance `idea.capitalisation`, événement `capitalisation.build`) ; `GET /v1/ideas/:id/capitalisation` (dossier + état de réactivation selon `?signaux=`).
- **Tests** — `core/capitalisation.test.mjs` (6) + `backend/fastify/tests/portfolio.capitalisation.test.mjs` (3).
- **Spécifications** — EF-44 marqué 🟢 (SPECIFICATIONS_FONCTIONNELLES.md + §4.1 TECHNIQUES).

## v0.18.3 (2026-08) — EF-42 · Matrice de risques probabilisés

- **`core/risques.mjs`** (nouveau) — `niveauRisque` (score probabilité×impact, niveaux faible→critique), `addRisque`/`updateRisque`/`removeRisque` (enrichissement idempotent), `matriceRisques` (grille 5×5 + distribution), `detectDeclencheurs` (risques actifs ≥ seuil → raisons), `rapportRisques`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/risques` (add/update/remove, persistance `roadmap.risques`, gate `re_arbitrage` COMEX si déclencheur, événements `risque.add|update|remove|rearbitrage`) ; `GET /v1/ideas/:id/risques` (matrice + déclencheurs).
- **Tests** — `core/risques.test.mjs` (7) + `backend/fastify/tests/portfolio.risques.test.mjs` (3).
- **Spécifications** — EF-42 marqué 🟢 (SPECIFICATIONS_FONCTIONNELLES.md + §4.1 TECHNIQUES).

## v0.18.2 (2026-08) — Étape 7 · Réaliser (boucle monitor EF-43 + lecture exécution)

- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/execution/monitor` (boucle Projeter → Écouter : relève des KPIs constatés, évaluation seuils + dérive via `core/loop.mjs`/`core/kpi-drift.mjs`, persistance `idea.loop`, ouverture d'un gate `re_arbitrage` COMEX, événements d'audit `loop.monitor`/`loop.alert`) ; `GET /v1/ideas/:id/execution` (execution + progression + rapport d'impact).
- **Tests** — `backend/fastify/tests/portfolio.execution.test.mjs` (5) : démarrage pilote, jalons, passage de phase, clôture → `termine`, monitor seuil franchi → signal + re-arbitrage, monitor sans dérive → aucun signal.
- **Spécifications** — EF-43 marqué 🟢 (SPECIFICATIONS_FONCTIONNELLES.md + §4.1 TECHNIQUES).

## v0.18.1 (2026-08) — Étape 6 · Projeter (API roadmap + projections)

- **`core/roadmap.mjs`** (nouveau) — `buildRoadmap`, `projectFromIdea`, `isProjected`. Construit la `roadmap{jalons,raci,kpis,risques,gatesFuturs,ressources}` et les `projections{scénariosPondérés,valeurAttendue,p10/p50/p90}` (Monte-Carlo déterministe) à partir d'hypothèses fournies. Aucun nombre n'est inventé.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/roadmap` (construction + persistance, événement d'audit `project.roadmap`), `GET /v1/ideas/:id/roadmap` (lecture + rapport d'impact `impactReport`). Schema zod validé.
- **Tests** — `core/roadmap.test.mjs` (4) + `backend/fastify/tests/portfolio.roadmap.test.mjs` (2).
- **Spécifications** — EF-39/40/41 marqués 🟢 dans SPECIFICATIONS_FONCTIONNELLES.md; §4.1 SPECIFICATIONS_TECHNIQUES.md renforcé.

## v0.18.0 (2026-08) — Governed intelligence layers (P0 → P4)

### P0 — Epistemic tags + Decision packets
- **`core/epistemic.mjs`** — `tagEpistemic`, levels (`observed` → `unknown`), `aggregateEpistemic`, `explainUncertainty`. Stops confident wrongness.
- **`core/decision-packet.mjs`** — `compilePacket`, `applyEpistemicPolicy`, `assertGateable`, `renderPacketForGate`, `policyForPacket`. Packet is the single object shown at gates (now v0.4 with world/debt fields).

### P1 — Novelty as control loop + Dialectical contest
- **`core/novelty-controller.mjs`** — `runNoveltyControl`, kill near-duplicates, axis quotas, re-bisociate rounds.
- **`core/dialectic.mjs`** — heuristic + agent attack/rebut, `runTournament`, survival scoring.
- **`core/run-hooks-p1.mjs`** — opt-in orchestration hooks (`noveltyControl`, `dialectic`).

### P2 — Problem reframing + cheap frame gate
- **`core/frame.mjs`** — `assessFrame`, dimension scores, heuristic reframes, `runFrameControl`.
- **`core/run-hooks-p2.mjs`** — early opt-in frame control in `Orchestrator.run`.
- Weak frames auto-pick or open `frame_review` before expensive agent cycles.

### P3 — World model + multi-resolution gates
- **`core/world-model.mjs`** — `sketchWorldModel` (actors, constraints, resources, uncertainties, assumption ledger), `resolveGateLevel` (light / standard / heavy), `runWorldModelControl`.
- Critical assumptions + targeted falsifiers feed the decision packet.
- Gate depth adapts to stakes + coverage + epistemic rank.

### P4 — Adaptive compute + residual portfolio + decision debt
- **`core/adaptive.mjs`** — `computePressure`, `allocateCompute`, `buildResidualPortfolio`, `suggestRevisitTriggers`, `runAdaptiveControl`.
- Pressure drives maxSteps / dialectic depth / novelty rounds.
- Residual risk portfolio + decision-debt signals + revisit triggers on the packet / gate view.

### Integration
- **`core/run-hooks-p3p4.mjs`** — combined post-agent hooks.
- `Orchestrator.run` sequence: start → **P2 frame** → recall/position → agents → **P1 novelty/dialectic** → **P3/P4 world+adaptive** → **P0 packet** → gate.
- Packet / gateView surface: `worldModel`, `decisionDebt`, `revisitTriggers`, `preferredGateLevel`, `adaptiveBudget`.
- Tests: `frame.test.mjs` (7), `world-model.test.mjs` (5), `adaptive.test.mjs` (3).

### Discord scaffold (completes v16)
- **`core/connectors-discord.mjs`** — `DiscordAdapter` complet : verification Ed25519 (`X-Signature-Ed25519` + timestamp anti-rejeu 5 min), parse des interactions (PING, slash, boutons, modal), rendu embeds + boutons, modal de motif, `buildGateView` / `buildGateResultView`.
- **`core/connectors-discord-deep.mjs`** — `verifyDiscordSignature`, `discordInteractionId` (idempotence EF-92), `discordEmbedColor`.
- **`core/connectors.mjs`** — `ConnectorService._handleGate` honore `_motifConfirmed` (resolution reject/revise avec motif horodaté, EF-20).
- **Backend** — `POST /v1/connectors/discord/interactive` (PING pong, signature, route gate approve / modal motif / resolve) + `discordAdapter` branche sur env (`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `DISCORD_APPLICATION_ID`, `DISCORD_GATE_CHANNEL`).
- Tests: `connectors-discord.test.mjs` (23) — signature réelle, parse, rendu, flux gate via `ConnectorService`.

### Teams adapter (completes v17)
- **`core/connectors.mjs`** — `TeamsAdapter` complet : verification JWT RS256 Azure Bot (issuer `https://api.botframework.com`, audience = App ID, cache JWKS 6 h, fetch de secours via openid config), jeton OAuth2 bot (client_credentials, cache −60 s), envoi proactif (conversations/activities) + webhook, update d'activité, Task Module de motif (EF-20), `buildGateView` / `buildGateResultView`, `renderMotifCard`, `_activityPayload` (Adaptive Card).
- **Backend** — `POST /v1/connectors/teams/interactive` (JWT obligatoire → 401, idempotence `teamsActivityId`, invoke adaptiveCard → gate approve / Task Module motif / resolve) + `teamsAdapter` branché sur env (`TEAMS_APP_ID`, `TEAMS_BOT_PASSWORD`, `TEAMS_WEBHOOK_URL`, `TEAMS_GATE_CHANNEL`).
- Tests: `connectors-teams.test.mjs` (27) — signature RS256 (accept/tamper/exp/iss/aud), parse message/invoke, rendu Adaptive Card, post/update bot + webhook, flux gate via `ConnectorService`. Suite complète 273/273.

### v0.17–v0.18 — Engine/adapters split + CI
- **Teams adapter (v0.17)** — cf. section ci-dessus.
- **Engine/adapters split (v0.18)** — `core/` reste zero-dependency ; connecteurs/`core/adapters/` et `backend/adapters/` sont optionnels (LangChain, LangGraph, recherche, Langfuse) ; couches P0–P4 contrôlées gouvernance.
- **CI GitHub Actions** — workflow `backend-tests.yml` (npm ci + `npm test`) s'ajoute à `core-tests.yml` et `i18n-check.yml`.

### Persistent audit trail (EF-32)
- **`core/audit.mjs`** — `InMemoryAuditStore` + `FileAuditStore` (JSONL, append-only, hydratation au démarrage, ring buffer configurable). `createAuditStore` selon `KAYROS_AUDIT_FILE`.
- **`backend/fastify/lib/context.mjs`** — `ctx.journal` persiste chaque événement cycle/gate/commentaire/vote/timeline et réhydrate `ctx.activites` au démarrage (la timeline survive aux redémarrages). Expose `auditStore`.
- **`.env.sample`** — `KAYROS_AUDIT_FILE` / `KAYROS_AUDIT_RING`.
- Tests: `audit.test.mjs` (7) — InMemory where/list/ring, FileAuditStore reload/persist/best-effort/missing-file/ring. Suite core 290/290.

### Working Group + vote multi-criteres (EF-13 / EF-21)
- **`core/working-group.mjs`** — `WorkingGroupStore` + `FileWorkingGroupStore` (membres, quorum par défaut 50%, agrégation rôle-pivot via `ROLE_WEIGHTS`, statut `vide`/`en_attente`/`quorum_ok`, recommandation Go/Révision/No-Go/Attendre quorum).
- **`backend/fastify/routes/gates.mjs`** — `POST /v1/ideas/:id/working-group` (création WG), `POST /v1/gates/:gateId/votes` (vote membre, 403 non-membre, idempotence), `GET /v1/gates/:gateId/votes` (agregat + participations). La décision reste une resolution RBAC formelle ; le vote WG est consultatif et alimente l'évaluation du gate.
- **`lib/context.mjs`** — `workingGroups` (store, `KAYROS_WG_FILE` optionnel) exposé dans le contexte.
- Tests: `working-group.test.mjs` (10) + backend `gates.working-group.test.mjs` (5).
- **Audit WG** — chaque vote WG est journalisé (`wg.vote`) et `POST /v1/gates/:gateId/resolve` journalise `gate.resolved`; `GET /v1/gates/:gateId` expose l'agregat du groupe de travail (participants, quorum, recommandation).

---

## v0.16.x (2026-08) — Adapters & observability periphery

See prior history for adapters, KPI drift, novelty ranking.
