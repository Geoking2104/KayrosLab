import type { SpecSection } from "./types";

export const SPECS: SpecSection[] = [
  {
    id: "f-vision",
    kind: "functional",
    linkedView: "board",
    titleFr: "Vision — tableau de travail, pas 15 vues",
    titleEn: "Vision — a work board, not 15 views",
    bodyFr:
      "La Console KayrosLab est le poste unique d'un tenant. La maison n'est plus une matrice de 15 surfaces parallèles : c'est un tableau kanban à quatre colonnes (À traiter → En cycle → À arbitrer → Mesuré), inspiré de la simplicité Multica et de la clarté Cursor.\n\nPrincipes non négociables :\n1. Un geste primaire par vue. Le tableau est la maison ; l'atelier (matrice, mémoire, novelty…) est secondaire.\n2. Tout est éditable — libellés, pondérations KI, agents, faits, portes, specs.\n3. Toute visualisation aboutit à un résultat mesuré — KI, novelty, verdict de porte, KPI observé vs P10–P90.\n4. Vote instruit, veto décide. L'humain reste l'arbitre — pingé dans l'Inbox, pas à chaque trace.\n5. Toute simulation (Oracle, TimesFM, personnalité) est labellisée SIMULATION.\n6. Guide d'installation en 5 minutes : atelier → essaim → idée → cycle → porte.",
    bodyEn:
      "KayrosLab Console is the tenant's single workstation. Home is a four-column kanban, not 15 parallel surfaces. Everything is editable. Playfulness serves the decision. Every visualization ends in a measured result. Vote instructs, veto decides. Simulations are labelled. Setup is five minutes.",
  },
  {
    id: "f-board",
    kind: "functional",
    linkedView: "board",
    titleFr: "F0 — Tableau kanban (maison)",
    titleEn: "F0 — Kanban board (home)",
    bodyFr:
      "Quatre colonnes, cartes déplaçables, un essaim en équipier sur chaque carte.\n- À traiter : nouveau, pause, dormant (réactivable).\n- En cycle : en_developpement / discussion / run live (pulse).\n- À arbitrer : en_revue, porte ouverte, consensus essaim en attente.\n- Mesuré : termine, KPI observé.\n\nClic = inspecteur. Lancer / Arbitrer / Réactiver selon la colonne. C crée une idée. Une carte ne passe à Mesuré que si le cycle a réalisé — pas de short-circuit de porte.\n\nAcceptation : un opérateur comprend le flux en moins d'une minute, sans ouvrir l'atelier.",
    bodyEn:
      "Four columns, draggable cards, swarm as teammate. Click inspects. C creates. A card reaches Measured only after Execute. An operator understands the flow in under a minute.",
  },
  {
    id: "f-guide",
    kind: "functional",
    linkedView: "guide",
    titleFr: "F0b — Guide & installation (adapté Multica)",
    titleEn: "F0b — Guide & setup (Multica-adapted)",
    bodyFr:
      "Quickstart 5 minutes, calqué sur Multica (sign in → connect a computer → create an agent → assign an issue) et transposé :\n1. Ouvrir l'atelier (tenant local, pas de compte).\n2. Composer un essaim (runtime Kayros = rôles + veto, pas un daemon CLI).\n3. Déposer une idée (unité de travail = carte, pas un ticket de code).\n4. Lancer le cycle 00–08.\n5. Arbitrer à la porte (Inbox).\n\nLe guide documente aussi ce que l'on ne copie pas : 26 CLI coding agents, daemon machine, merge de PR. KayrosLab gouverne une décision jusqu'au KPI.",
    bodyEn:
      "Five-minute setup mapped from Multica's sign-in / runtime / agent / issue onto workspace / swarm / idea / cycle / gate. Coding-agent runtimes are explicitly out of scope.",
  },
  {
    id: "f-matrix",
    kind: "functional",
    linkedView: "matrix",
    titleFr: "F1 — Matrice 3×3 du cycle (atelier)",
    titleEn: "F1 — 3×3 cycle matrix (studio)",
    bodyFr:
      "La matrice expose les 9 cellules (00 Recueillir … 08 Réaliser) en lecture LTR/TTB. Chaque cellule affiche numéro, nom (éditable), agent assigné, état (idle / running / done / gated), extrait de sortie, contribution KI.\n\nInteractions :\n- Clic = inspecteur (tous les champs de l'étape).\n- Double-clic = édition inline du libellé.\n- « Lancer le cycle » déplace un jeton de cellule en cellule, émet les événements de type SSE (meta → start → recall → positionning → trace×N → distill → synthesis → gate → final → done).\n- Une boucle visuelle Réaliser → Écouter matérialise le feedback KPI.\n- Une cellule désactivée (Studio) est sautée, jamais exécutée.\n\nAcceptation : un opérateur relance un cycle complet sans quitter la matrice et voit un résultat mesuré en fin de Réaliser.",
    bodyEn:
      "The 3×3 matrix is a studio surface, not home. Click inspects, Run Cycle streams SSE-style events, Execute feeds Listen. Disabled cells are skipped.",
  },
  {
    id: "f-cycle",
    kind: "functional",
    linkedView: "cycle",
    titleFr: "F2 — Cycle stratégique 8 étapes + SSE",
    titleEn: "F2 — 8-step cycle + live SSE",
    bodyFr:
      "Le cycle est la recette d'exécution. Recueillir structure le brief. Écouter produit des signaux pondérés. Cartographier un graphe de tendances. Construire des collisions Bisociateur. Positionner injecte des faits concurrent L1. Éprouver attaque (Critic / Devil's Advocate / Red Team). Arbitrer ouvre une porte. Projeter une roadmap + forecast. Réaliser des jalons et KPI observés.\n\nSSE live : chaque événement est horodaté, rejouable, inspectable. En production : POST /v1/cycle/run. Ici : moteur déterministe + option Grok (appel initié par l'utilisateur).\n\nLe stage (exécution) et le status (décision) restent orthogonaux. Une idée peut être en_revue tout en étant en construire.",
    bodyEn:
      "Eight operational steps after intake. Stage and status stay orthogonal. Live event stream is inspectable and replayable.",
  },
  {
    id: "f-memory",
    kind: "functional",
    linkedView: "memory",
    titleFr: "F3 — Mémoire stratifiée L0–L3",
    titleEn: "F3 — Layered memory L0–L3",
    bodyFr:
      "L0 working / offload. L1 faits atomiques (y compris concurrents issus du Positioner). L2 scénarios distillés. L3 persona / normes / skills, scopés tenant.\n\nPromotion L0 → L1 → distill L2 → promote L3. Chaque fait est éditable, sourcé, supprimable. Le recall d'un cycle cite L1–L3. Isolation tenant : aucun fait d'un autre espace n'apparaît.",
    bodyEn:
      "L0 working, L1 atomic facts, L2 distilled scenarios, L3 persona/norms. Promotion path is explicit and editable.",
  },
  {
    id: "f-gov",
    kind: "functional",
    linkedView: "inbox",
    titleFr: "F4 — Gouvernance, portes, veto",
    titleEn: "F4 — Governance, gates, veto",
    bodyFr:
      "Une synthèse sensible ouvre une porte. Les votes sont pondérés par rôle. Un agent à veto_power = true peut forcer NO_GO. L'humain tranche : approve → en_developpement / projeter ; reject → non_poursuivi (dormant, réactivable) ; revise → en_revue / eprouver.\n\nLe motif de décision est obligatoire. Le fil de décision conserve contributions, preuves, objections, conditions, synthèse, verdict.",
    bodyEn:
      "Sensitive synthesis opens a gate. Weighted votes instruct; veto decides. Human approve / reject / revise maps to idea status and stage.",
  },
  {
    id: "f-novelty",
    kind: "functional",
    linkedView: "novelty",
    titleFr: "F5 — Novelty engine + Kayros Signature",
    titleEn: "F5 — Novelty engine + Kayros Signature",
    bodyFr:
      "Le Bisociateur émet des collisions structurées : Framework + Mechanism + Proposal + Bridge. Le score de nouveauté = 0.40 × diversité intra-lot + 0.40 × distance mémoire + 0.20 × distance à l'entrée. Filtre doux des quasi-doublons (cosinus ≥ 0.82).\n\nKayros Signature : chaque candidat porte un pont conceptuel non-évident, éditable, affiché sur la carte. C'est ce qui rend l'option unique — pas le slogan.",
    bodyEn:
      "Collisions are ranked by intra-batch diversity, memory distance and input distance. Each candidate carries a Kayros Signature — a non-obvious conceptual bridge.",
  },
  {
    id: "f-pos",
    kind: "functional",
    linkedView: "positioner",
    titleFr: "F6 — Positioner, ontologie, OWL",
    titleEn: "F6 — Positioner, ontology, OWL",
    bodyFr:
      "Sources : web, GitHub, GitLab, ArXiv. Sorties : graphe d'ontologie inspectable, export OWL, faits concurrent injectés en L1. Les nœuds et relations sont éditables. Un gap explicite (ce que les plateformes d'idéation ne gouvernent pas) est un premier-class citizen.",
    bodyEn:
      "Web / GitHub / GitLab / ArXiv scan, inspectable ontology, OWL export, competitor facts into L1.",
  },
  {
    id: "f-llm",
    kind: "functional",
    linkedView: "studio",
    titleFr: "F7 — LLM quant-aware + fallback",
    titleEn: "F7 — Quant-aware LLM + fallback",
    bodyFr:
      "Chaque agent déclare provider / modèle / quant. Chemin souverain : tag Ollama → strip quant → mock marqué degraded. Les rôles lourds (Red Team, Synthesizer) montent de palier. Rien n'est appelé en boucle ni au chargement : tout appel LLM est initié par l'utilisateur.",
    bodyEn:
      "Role-tiered Ollama tags, strip-quant retry, mock fallback marked degraded. User-initiated calls only.",
  },
  {
    id: "f-swarm",
    kind: "functional",
    linkedView: "swarms",
    titleFr: "F8 — Essaims spécialisés + personnalité consentie",
    titleEn: "F8 — Specialized swarms + consented personality",
    bodyFr:
      "Un essaim compose des agents système, custom ou hybrides. Règles empilées (système / modifiées / ajoutées utilisateur). Veto explicite. Un profil hybride n'existe qu'avec consentement, provenance, et interdiction d'usage RH / crédit / logement. Crystal Knows et LinkedIn uniquement via API officielles ou export structuré autorisé.\n\nArchitecture visible dans la vue Essaims : Tenant → registre → configuration → run gouverné → arbitrage humain (accept_consensus / override_veto / reevaluate). Seuils : majority, unanimous, veto_power_csuite. Le consensus est consultatif jusqu'à l'arbitrage. Toute exécution est labellisée SIMULATION.",
    bodyEn:
      "Compose system, custom or hybrid agents with layered rules and veto. Personality is opt-in, consented, and never used for hiring or credit.",
  },
  {
    id: "f-oracle",
    kind: "functional",
    linkedView: "oracle",
    titleFr: "F9 — Sales Oracle",
    titleEn: "F9 — Sales Oracle",
    bodyFr:
      "Deux modes : comité exécutif interne, comité d'achat client (RFP, renouvellement, négociation). Sorties : veto path, objections, trous de preuve, conditions de GO. Le verdict est consultatif jusqu'à l'arbitrage humain. Toute réaction simulée est labellisée SIMULATION — jamais une citation réelle.",
    bodyEn:
      "Rehearse internal exec or customer buying committees. Outputs: veto paths, objections, evidence gaps, conditional-GO. Always labelled SIMULATION.",
  },
  {
    id: "f-mcp",
    kind: "functional",
    linkedView: "mcp",
    titleFr: "F10 — Developer Portal MCP",
    titleEn: "F10 — Developer Portal MCP",
    bodyFr:
      "Catalogue d'outils agentiques least-privilege, scopés tenant. Codex, Claude Code, Cursor, VS Code se connectent via token à empreinte SHA-256. Les outils d'écriture (cycle.run, gates.resolve, swarm.run) restent gouvernés : une exécution MCP ouvre les mêmes portes qu'une exécution Console.",
    bodyEn:
      "Tenant-scoped least-privilege tool catalog. MCP writes still open the same human gates.",
  },
  {
    id: "f-store",
    kind: "functional",
    linkedView: "studio",
    titleFr: "F11 — Stores multi-tenant",
    titleEn: "F11 — Multi-tenant stores",
    bodyFr:
      "En production : JSON files ou Postgres (DATABASE_URL) pour idées, portes, account links. Ici : workspace persisté localement, export/import JSON du tenant entier. Isolation : un seul tenant dans la session, pas d'id client-sent pour l'auth (l'auth réelle vit côté Fastify).",
    bodyEn:
      "Production: JSON or Postgres. This console: local workspace with full JSON export/import.",
  },
  {
    id: "f-chat",
    kind: "functional",
    linkedView: "connectors",
    titleFr: "F12 — Connecteurs chat",
    titleEn: "F12 — Chat connectors",
    bodyFr:
      "Slack : signature, idempotence, Block Kit, motif modal, chat.update.\nTeams : JWT RS256 Azure Bot, Adaptive Cards, gate/EF-20, envoi proactif + webhook.\nDiscord : Ed25519, embeds, /kayros.\nLa Console ne voit jamais les secrets. États : à configurer / à tester / connecté / erreur / désactivé. Un salon relie un canal à un essaim stable.",
    bodyEn:
      "Slack, Teams, Discord with cryptographic verification. Secrets never reach the browser. A room binds one channel to one swarm.",
  },
  {
    id: "f-port",
    kind: "functional",
    linkedView: "board",
    titleFr: "F13 — Portfolio, dormant, ontologie",
    titleEn: "F13 — Portfolio, dormant, ontology",
    bodyFr:
      "Kanban par statut (nouveau, en revue, discussion, en développement, terminé, non poursuivi, considération future, en pause). Les statuts dormants sont réactivables. Drag des cartes. Inspecteur d'idée. L'explorateur d'ontologie est le même graphe que le Positioner, embarquable.",
    bodyEn:
      "Status kanban, reactivable dormant ideas, shared ontology explorer.",
  },
  {
    id: "f-forecast",
    kind: "functional",
    linkedView: "forecast",
    titleFr: "F14 — TimesFM 2.5 + projections déterministes",
    titleEn: "F14 — TimesFM 2.5 + deterministic projections",
    bodyFr:
      "Les projections déterministes restent la baseline. TimesFM (optionnel, isolé) produit des bandes P10–P90 sur ≥ 20 observations, persistées tenant, labellisées SIMULATION. Si l'uncertainty ratio dépasse le seuil, revue humaine obligatoire. Jamais un substitut au jugement des agents ni à la porte.",
    bodyEn:
      "Deterministic projections are baseline. Optional TimesFM adds P10–P90 bands, always labelled SIMULATION, with mandatory review on wide intervals.",
  },
  {
    id: "f-adapt",
    kind: "functional",
    linkedView: "studio",
    titleFr: "F15 — Adapters V16 (périphérie)",
    titleEn: "F15 — V16 adapters (periphery)",
    bodyFr:
      "LangChain tools, LangGraph research runner, search multi-provider, Langfuse. Tous périphériques. Le cœur (orchestrateur, gouvernance, mémoire, novelty) reste zero-dep et non remplaçable par un graphe externe.",
    bodyEn:
      "LangChain, LangGraph, search, Langfuse stay optional peers. Core remains zero-dep.",
  },
  {
    id: "f-edit",
    kind: "functional",
    linkedView: "studio",
    titleFr: "F16 — Editabilité totale",
    titleEn: "F16 — Total editability",
    bodyFr:
      "Mode « tout éditer » activé par défaut. Inline sur libellés. Inspecteur sur l'entité sélectionnée. Studio pour le schéma (étapes, poids KI, flags, tenant, agents). Specs éditables. Export / import JSON. Reset vers la graine de démo. Rien n'est un label mort.",
    bodyEn:
      "Edit-everything on by default. Inline labels, inspector, studio schema, editable specs, JSON import/export.",
  },
  {
    id: "f-measure",
    kind: "functional",
    linkedView: "result",
    titleFr: "F17 — Visualiser jusqu'au résultat mesuré",
    titleEn: "F17 — Visualize through to a measured result",
    bodyFr:
      "Le module Résultat agrège : radar KI (5 dimensions stratégiques), classement novelty + signatures, barres de vote, fan chart P10–P90 vs actuals, hit ratio, jalons, verdict de porte, gaps Oracle. C'est le contrat de fin de cycle : pas de slide, un scorecard signé par la porte humaine.",
    bodyEn:
      "The Result module is the cycle contract: KI radar, novelty, votes, forecast vs actuals, gate verdict, oracle gaps.",
  },
  {
    id: "t-arch",
    kind: "technical",
    linkedView: "studio",
    titleFr: "T1 — Architecture",
    titleEn: "T1 — Architecture",
    bodyFr:
      "Console React (cette app) = workbench 100 % client + appels xAI initiés par l'utilisateur.\nProduction KayrosLab = React /console → Fastify /v1/console/* → SwarmService, HybridAgentGateway, ConnectorConfigurationService, PostgreSQL.\n\nCouches :\n- Core zero-dep : orchestrateur, L0–L3, novelty, gouvernance, KI.\n- ToolRegistry : outils déclaratifs, gates sur les side-effects.\n- Adapters : TimesFM, search, LangChain, LangGraph, Langfuse.\nLa Console ne contourne jamais une porte.",
    bodyEn:
      "This workbench is client-side with user-initiated xAI. Production maps to Fastify + Postgres. Core stays zero-dep.",
  },
  {
    id: "t-data",
    kind: "technical",
    linkedView: "studio",
    titleFr: "T2 — Modèle de données",
    titleEn: "T2 — Data model",
    bodyFr:
      "Workspace { tenant, steps[], ideas[], agents[], swarms[], memory[], gates[], connectors[], mcpTools[], oracleCases[], cycle, kiWeights, flags, specs }.\nIdée : stage × status orthogonaux, KI, collisions, ontologie, attaques, votes, forecast, kpis, history[].\nKI : 6 dim techniques → 5 stratégiques via matrice de pondération éditable, score global = moyenne des 5.\nProduction PG : kayros_ideas, kayros_gates, kayros_decision_threads, kayros_connector_configurations (secrets AES-256-GCM).",
    bodyEn:
      "Workspace is the unit of persistence. Idea keeps orthogonal stage×status. KI maps 6 technical dims to 5 strategic via editable weights.",
  },
  {
    id: "t-engine",
    kind: "technical",
    linkedView: "cycle",
    titleFr: "T3 — Moteur (déterministe + Grok)",
    titleEn: "T3 — Engine (deterministic + Grok)",
    bodyFr:
      "Embeddings mock : vecteur 24d hashed bag-of-words, cosinus. Novelty scoreNovelty(batch, memory, input). Bisociation : catalogue de frameworks, pont = mechanism(framework) → cible. Forecast : drift + σ√h pour P10/P90, actuals déterministes via seed. Votes pondérés, veto si weight≥2 et NO_GO.\nOption Grok (grok-4.5) : génération de collisions + signatures, max_tokens borné, un appel par run, jamais au chargement.",
    bodyEn:
      "Hashed embeddings, novelty weights 0.4/0.4/0.2, deterministic forecast bands. Optional grok-4.5 for collisions, user-initiated, capped.",
  },
  {
    id: "t-persist",
    kind: "technical",
    linkedView: "studio",
    titleFr: "T4 — Persistance",
    titleEn: "T4 — Persistence",
    bodyFr:
      "localStorage clé kayros-console-v4 (board-first, guideDismissed). skipHydration pour SSR. Export JSON téléchargeable. Import remplace le workspace après validation. Reset restaure SEED. En production : DATABASE_URL + schema idempotent.",
    bodyEn:
      "localStorage kayros-console-v4 with SSR skipHydration. JSON export/import. Production uses Postgres.",
  },
  {
    id: "t-map",
    kind: "technical",
    linkedView: "mcp",
    titleFr: "T5 — Mapping API production",
    titleEn: "T5 — Production API mapping",
    bodyFr:
      "POST /v1/cycle/run · POST /v1/cycle/reactivate\nGET|POST /v1/memory/* · POST /v1/memory/promote\nPOST /v1/gates/:id/resolve\nPOST /v1/swarm/run · POST /v1/swarm/runs/:id/arbitrate\nPOST /v1/sales-oracle/cases\nPOST /v1/ideas/:id/forecast\nPOST /mcp (Streamable HTTP)\nGET /v1/console/overview\nConnecteurs Slack / Teams / Discord signés.\nCette Console prototype les contrats ; elle n'émet pas les secrets.",
    bodyEn:
      "This console prototypes the Fastify contracts without emitting secrets.",
  },
  {
    id: "t-sec",
    kind: "technical",
    linkedView: "connectors",
    titleFr: "T6 — Sécurité et consentement",
    titleEn: "T6 — Security and consent",
    bodyFr:
      "Pas de secret en clair dans le bundle. Crystal / LinkedIn : consent_confirmed = true obligatoire. Personnalité interdite pour embauche, crédit, logement, assurance. Forecast et Oracle labellisés SIMULATION. MCP : token digest SHA-256, scopes, expiry. Veto et portes ne sont pas short-circuitables par un outil.",
    bodyEn:
      "No secrets in the bundle. Explicit consent for personality. SIMULATION labels. MCP tokens are digests with scopes. Tools cannot skip gates.",
  },
];
