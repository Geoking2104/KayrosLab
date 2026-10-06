# Salon × OpenKB — Knowledge-Base Integration Specification

**Status:** draft v1 · 2026-10-03 · scope: the Salon service only (not the console, not the workflow engine)
**Upstream:** [VectifyAI/OpenKB](https://github.com/VectifyAI/OpenKB) — Open LLM Knowledge Base, Apache-2.0. Reference inspected: commit `ff54396` (2026-10). Also: [PageIndex](https://github.com/VectifyAI/PageIndex), [openkb.ai](https://openkb.ai)
**Related docs:** [`SALON.md`](./SALON.md) · [`SALON-AGENT-AUTEUR.md`](./SALON-AGENT-AUTEUR.md) · [`SALON-MOTEUR-DETERMINISTE.md`](./SALON-MOTEUR-DETERMINISTE.md) · [`SALON-X.md`](./SALON-X.md) · [`SALON-X-API-USAGE.md`](./SALON-X-API-USAGE.md)
**Files touched (target):** `salon/scripts/` (new pipeline), `salon/src/lib/salon/` (consume packs), `backend/fastify/lib/salon-kb.mjs` + `routes/salon-kb.mjs` (new bridge), `backend/web/public/salon/` (published packs), deploy scripts.

> **Résumé (FR).** Cette spécification décrit la réorganisation de la mémoire des auteurs du Salon avec OpenKB. Principe : **1 auteur = la somme de tous ses livres enregistrés**, compilés dans une base de connaissances dédiée (wiki + index PageIndex). Le Salon en tire deux choses : (1) des *packs* déterministes régénérés hors-ligne (phrases entières citables, formules d'auteur, provenance complète) qui remplacent le corpus fragmenté actuel ; (2) un pont serveur *contextuel* qui interroge la base selon la question de table ou le tweet de la Gazette. Les répliques restent gouvernées par le contrat PRISE/RÉPLIQUE : une seule œuvre nommée, une phrase entière, jamais de citation fabriquée — sinon l'aveu du manque.

---

## 0. TL;DR

1. **Re-organize the knowledge base per author.** Each author gets one OpenKB knowledge base whose `raw/` folder is the union of **all his registered books** (the `works[]` list of `catalog.json`). OpenKB compiles them into a wiki (per-book summaries, cross-book concept pages, entity pages) with PageIndex tree retrieval for long books. This is the "1 author = (sum of all of his registered books)" invariant, implemented literally.
2. **Two consumptions of the same KB.** (a) *Offline*: a deterministic export produces **Salon packs** — whole-sentence passages with provenance, a bank of the author's **formulas**, and a work registry — published as static JSON next to the app. (b) *Online*: a server-side bridge queries the author's KB **with the context of the question or the tweet** and returns passages/synthesis for the reply.
3. **The speech contract does not change.** PRISE + RÉPLIQUE, 90–170 words, one named work, one whole sentence (or the avowal of the lack), ressaisir → position → ancrer → avancer. OpenKB feeds the memory and the grounding; Salon keeps the composition rules and the deterministic fallback.
4. **Coherence is engineered at retrieval time.** The bridge builds its query from: the table question + the turn being answered (last *prise*) + the speech act (réponse / objection / elenchus) + the demand/domain framing (`scope()`) + (Gazette) the text of the source post.
5. **Reliability = a fallback chain that never fabricates:** OpenKB bridge → static pack engine (deterministic) → avowal of the lack. Every quoted sentence is substring-verified against the registered source text.

### Implementation status — v1.1 · 2026-10-03

**Shipped in this repository (M0/M1 bricks — testable without the OpenKB server).**

| Brick | File(s) | State |
|---|---|---|
| Ingest (per-author raw staging) | `salon/scripts/openkb_ingest.mjs` | ✅ (`--author`, `--all`, `--dry-run`) |
| REST sync (init → add → recompile) | `salon/scripts/openkb_sync.mjs` | ✅ (degrades cleanly when OpenKB is unreachable) |
| Pack export + validator | `salon/scripts/kb_export.mjs` | ✅ — **bootstrap packs published for all 54 authors** (`--from-corpus`); `--check` validates outputs |
| Quote audit | `salon/scripts/kb_quote_audit.mjs` | ✅ (active once sources are staged) |
| Server bridge | `backend/fastify/lib/salon-kb.mjs` + `routes/salon-kb.mjs` (`POST /v1/salon/kb/query`, `GET /v1/salon/kb/manifest`, `GET /v1/salon/kb/status/:authorId`) | ✅ |
| Client | `backend/web/public/salon/salon-kb.js` + guarded hook in `circle-run.js` | ✅ activé — `window.SALON_KB_CONFIG` est défini dans les deux `index.html` ; le pont ne s'ouvre que pour une session liée (jeton `kayros-salon-token`) |
| Registry | `salon/kb-map.json` (generated) | ✅ |
| Tests | `tests/salon-openkb.test.mjs` · `backend/fastify/tests/salon-kb.test.mjs` | ✅ |

Commands:

```bash
node salon/scripts/openkb_ingest.mjs --all        # stage raw/<slug>.txt + balanced parts
node salon/scripts/openkb_sync.mjs --all          # init/add/recompile (needs OpenKB)
node salon/scripts/kb_export.mjs                  # packs from the KBs
node salon/scripts/kb_export.mjs --from-corpus    # bootstrap mode (no OpenKB needed)
node salon/scripts/kb_export.mjs --check          # validate published outputs
node salon/scripts/kb_quote_audit.mjs --all       # citation fidelity audit
```

Data status: this commit publishes **bootstrap packs** (`source: bootstrap-corpus`) — whole sentences from the existing corpus, work-level provenance. The M0 OpenKB runs will switch `source` to `openkb` and add chapter-level loci plus wiki-derived concepts/entities. The bridge reads the packs; the client changes behaviour only when configured.

---

## 1. Context — how Salon works today (as-is)

### 1.1 Surfaces

| Surface | Path | Role |
|---|---|---|
| Playable static salon | `salon/index.html` + `backend/web/public/salon/*` | The live page (kayroslab.com/salon). Loads `corpus.json`, `salon-engine.js` (deterministic), `circle-run.js`, `circle-speech.js`, `gazette-desk.js`, `flux-x.js`. |
| SPA library | `salon/src/lib/salon/*` | React/TanStack sources: `catalog.ts`, `corpus.json` (passages shape), `reflect.ts`, `speak.ts`, `engine.ts`, `memory.ts`, `knowledge.ts`, `store.ts`… |
| Server (optional) | `backend/fastify/*` | X/Gazette API (`salon-x.mjs`), state sync (`salon.mjs`), LLM relay (`/v1/demo/chat`, `/v1/llm`). |
| Rust/WASM core | `crates/salon-core`, `salon_core.wasm` | Floor / retrieval (`salon_eval`). |

### 1.2 Knowledge, today

- `catalog.json` — **source of truth** for authors and their registered works (title, Gutenberg URL, `ok`, sample, terms). An author is created only with ≥ 5 public-domain works.
- `authors-pack.json` — method per author (`auto` / `rhetorique` / `elenchus`).
- `corpus.json` — the *memory*. Two projections exist:
  - static app: `{ "<author>": [ { "w": "<work>", "s": "<sentence>" } … ] }` (harvested whole sentences, ~2 000 sentences / 54 authors, min. 18 per author);
  - SPA: `{ "<author>": { "passages": [ { "id", "work", "text", "terms" } ], "terms", "sample" } }`.
- Retrieval: lexical (`relevance()` in `reflect.ts` / `salon-engine.js`), domain vocabulary (16 domains, FR+EN keys), `bestSentence()` cleaning.
- Composition: `scope()` (demand: definition/cause/manière/norme/vérité/quantité/valeur/thèse) → `retrieve()` → `compose()`; LLM path: `speak.ts` (persona + thread + passages) with deterministic fallback `composeFromMemory()`.
- Gazette (X): host links their own X account; a pasted post grounds the discussion; a reply is published only if the host is @mentioned (≥ 45 s between posts, idempotent, 24 h retract). See `SALON-X-API-USAGE.md`.

### 1.3 Why "actual results are not reliable" — and what fixes each cause

| Observed failure | Root cause | Mechanism in this spec |
|---|---|---|
| Replies that ignore the question | prompt carried only the author's name; fragments not conditioned on the question | per-author KB + **context-conditioned query** (§7); packs injected into persona/floorPrompt |
| Replies that are not *sentences* | passages were 720–900-char slices cut mid-sentence | packs carry **whole sentences only**; export validator rejects truncation (§6, §12) |
| Off-topic anchors ("table" → a dinner in *Candide*) | shallow lexical overlap; no semantic retrieval | PageIndex reasoning retrieval + concept/entity facets + tags (§5, §7) |
| Not genuinely "from the books" | no provenance; paraphrase drift in the LLM path | every passage/formula carries `work` + locus + `kbVersion`; quote audit (§12) |
| Style drift | persona prompt is thin; corpus sampling sparse (18–48 sentences/author) | formulas bank + voice profile per author, built from **all** registered books (§6) |
| FR question vs EN books | pure lexical, cross-lingual gap | query-side translation or bilingual keys; citations stay in the book's language (§7.4) |

---

## 2. Goals, non-goals, success criteria

### 2.1 Goals

- **G1 — Context coherence.** Each turn visibly answers *the* question of the table (or the tweet), not a neighbouring one.
- **G2 — Quote fidelity.** Every cited sentence is a whole sentence attested in a registered book of that author; every claim of "my books say" is traceable.
- **G3 — Authorial formulas.** Replies reuse the author's genuine formulations (verbatim) and style patterns (attested), so the voice reflects his thinking across the union of his books.
- **G4 — Reliability & honesty.** No fabrication anywhere; missing grounding ⇒ explicit avowal. Deterministic fallback always available.
- **G5 — Operability.** Adding a work or an author is one pipeline run. Rebuilds are idempotent and versioned.
- **G6 — Performance.** The app never waits on a cold model: packs are static; the online path is cached.

### 2.2 Non-goals

- Not an auto-poster: every X reply stays human-initiated and mention-gated (`SALON-X-API-USAGE.md` §7).
- No ingestion of tweets, threads or user text into KBs; no model training on X data.
- No non-registered works, no invented works, no paraphrase presented as quotation.
- Not replacing `scope()`/the dialogue logic (`planTurn`, actes, elenchus); OpenKB is a memory & grounding layer.
- Not betting the runtime on LLM availability: the deterministic path must survive without any API key.

### 2.3 Success metrics

| # | Metric | Baseline | Target |
|---|---|---|---|
| M1 | Turn rated "on-question" (blind panel) | qualitative complaints (moteur doc §1) | ≥ 90 % on golden set |
| M2 | Quoted sentences substring-verified | partial | 100 %; 0 fabricated quotes / 200 sampled |
| M3 | Style match (blind pairwise vs current) | — | ≥ 70 % preference, pilot authors |
| M4 | Fallback rate (no grounding possible) | high (fragments, lexical misses) | ≤ 10 % on golden set |
| M5 | Provenance coverage | ~0 % | 100 % of passages & formulas |
| M6 | Latency | ms (in-browser) | static packs: unchanged; bridge: ≤ 1.5 s p95 (retrieval, cached), ≤ 6 s p95 uncached; ≤ 12 s p95 (answer mode) |
| M7 | Cost | — | build ≤ ~1–2 €/author/month (nightly changed-only); query cache ≥ 70 % hit |

---

## 3. OpenKB primer (as used by Salon)

OpenKB is a CLI + REST service that **compiles raw documents into an interlinked wiki-style knowledge base** using LLMs, with [PageIndex](https://github.com/VectifyAI/PageIndex)'s vectorless, reasoning-based retrieval for long documents. Beyond RAG: knowledge accumulates (concept pages are updated cross-document), contradictions and cross-references are kept, and answers are grounded with citations.

Key facts used by this spec:

- Install: `pip install "openkb[web]"` · serve: `openkb-web --host 127.0.0.1 --port 7566` (API + Workbench UI), or `python -m openkb.api`.
- Multi-KB: each knowledge base is a directory under `OPENKB_KB_ROOT` (default `~/.config/openkb/kbs`), addressed by name (`kb`).
- Auth: opt-in bearer token — set `OPENKB_API_TOKEN` (mandatory for us; server stays loopback-only).
- Wiki layout (per KB): `sources/`, `summaries/`, `concepts/`, `entities/`, `explorations/`, `reports/`, plus `index.md`, `log.md`. Pages are plain Markdown with `[[wikilinks]]`; frontmatter carries a `type:` (OKF/Google-aligned); pages are enumerable and machine-readable.
- The wiki schema is governed by **`wiki/AGENTS.md`** — editable per KB. This is our primary customization hook (§5.3).
- Long books (PDF ≥ `pageindex_threshold`, default 20 pages) go through PageIndex tree indexing; short documents are read in full by the LLM (markitdown → Markdown).
- LLM: any LiteLLM provider (`provider/model`), configured per KB in `.openkb/config.yaml` + KB-local `.env`.
- Generators: `query`, `chat`, `visualize` (graph), `skill new` (portable agent skills), `deck new`.
- Endpoints we depend on (REST, `/api/v1`): `init`, `add`, `query`, `list`, `status`, `lint`, `remove`, `recompile`, `watch/*`. SSE for `query/add/remove/recompile`. Interactive OpenAPI at `/docs`.
- License Apache-2.0 → safe to vendor/operate; pin a version (see §11.1).

> **Caveat to validate at spike (M0):** long-document handling is strongest for **PDF**; non-PDF long files are on OpenKB's roadmap. Our ingest therefore packages each book as a PDF (or chapter-split Markdown) — see §5.2.

---

## 4. Target architecture

### 4.1 Overview

```
┌─ BUILD  (offline: CI or nightly job on the VPS) ──────────────────────────────┐
│  catalog.json / authors-pack.json (registered books — source of truth)        │
│    └─ ingest:  fetch works → normalize → raw/<work>.pdf  [salon/scripts/*]    │
│         └─ openkb add  →  compile  →  wiki/ (summaries·concepts·entities)     │
│              └─ openkb lint / recompile                                       │
│                   └─ kb_export.mjs → SALON PACKS (static, versioned)          │
└───────────────────────────────────────────────────────────────────────────────┘
                  │ publishes (static files)                 │ loopback HTTP
                  ▼                                          ▼
┌─ RUNTIME A — static (browser) ─────────────┐  ┌─ RUNTIME B — server (Fastify) ─────┐
│ /salon/ app: circle-run.js + salon-engine  │  │ POST /v1/salon/kb/query            │
│ reads packs (enhanced corpus + formulas)   │  │   → bridge → OpenKB /api/v1/query  │
│ deterministic, no network needed           │  │   → passages + formulas + trace    │
└────────────────────────────────────────────┘  └────────────────────────────────────┘
        └──────────── both feed ─► floorPrompt / composeFromMemory ─────────────┘
                          PRISE + RÉPLIQUE (contract unchanged)
```

### 4.2 The three invariants

1. **Author aggregate.** For every author `a`, the KB `salon-<a>` contains exactly the union of `a`'s registered books — nothing else. (See §5.1.)
2. **One source of truth.** `catalog.json` (plus the custom-authors store) remains the registry; KBs and packs are *derived, rebuildable artifacts*. Deleting and rebuilding a KB from the registry must reproduce an equivalent pack.
3. **Never fabricate.** A sentence is quotable only if it exists in the registered source text; otherwise the agent avows the lack. Packs are validated for this; the bridge re-checks.

---

## 5. Knowledge re-organization — 1 author = Σ registered books

### 5.1 KB topology

- KB root on the server: `OPENKB_KB_ROOT=/srv/openkb/kbs`, organized as:
  ```
  /srv/openkb/kbs/salon/
    voltaire/        # kb id: "salon-voltaire"
      raw/           # the union of registered books (one PDF per book)
      sources/       # converted text + extracted images
      wiki/          # summaries / concepts / entities / explorations / AGENTS.md
      .openkb/       # config.yaml (model, language), .env (KB-local keys)
    smith/
    …
  ```
- One KB per author — including custom authors created in-app (`CreateAuthor.tsx`), provided the ≥ 5 public-domain works rule holds.
- Author id = existing `catalog.json` id (`voltaire`, `smith`, `marc-aurele`…). kb id = `salon-<id>`.
- A **registry map** connects the two worlds (new file, generated):
  ```json
  // salon/kb-map.json  (generated; committed)
  {
    "voltaire": {
      "kb": "salon-voltaire",
      "kbVersion": "voltaire@2026-10-03T02:10:00Z",
      "works": [
        { "title": "Candide", "source": "gutenberg", "url": "https://…/pg….txt",
          "hash": "sha256:…", "pack": "kb/voltaire.json", "status": "compiled" }
      ],
      "pack": { "path": "kb/voltaire.json", "builtAt": "…", "sentences": 342, "formulas": 88, "checksum": "sha256:…" }
    }
  }
  ```

### 5.2 Ingest pipeline (per author)

For each registered work of the author:

1. **Fetch** — Gutenberg URL from `catalog.json` (as `harvest_corpus.mjs` does today), or the custom source for added works.
2. **Normalize** — strip Gutenberg headers/footers (`*** START/END OF … ***`), drop editorial notices, prefaces, indexes; reuse the existing noise logic (`cutGutenberg`, `isNoise`, the `NOISE` regex of `harvest_corpus.mjs`). Record, per work: title, language, source URL, content hash, chapter map.
3. **Package** —
   - *Preferred:* render a clean, paginated **PDF per book** (so PageIndex applies to long texts: tree index + summaries + figures/tables handling).
   - *Fallback (if PDF generation is not wanted):* split the book into **chapter-level Markdown files** (`<work>.ch07.md`) — one "document" per chapter in the KB. Titles must be stable: `<Work Title> — Chapter n`.
   - *Rule:* never feed raw mid-sentence slices; the unit of ingestion is a whole book (or whole chapter), not excerpt fragments.
4. **Add** — `openkb add raw/<work>.pdf` (or directory). Idempotent by content hash: re-adding an unchanged work is skipped; a failed add is retryable.
5. **Compile** — automatic on `add`; `recompile` re-runs the compile step when the pipeline or prompts change.

### 5.3 Wiki schema customization (per KB) — "reflecting their thinking"

`wiki/AGENTS.md` is the LLM's instruction manual for maintaining the wiki and is read at runtime. For Salon KBs, replace the default schema with a literary-author schema, e.g.:

- `summaries/` — one per registered work: thesis, structure, key figures, notable formulations.
- `concepts/` — **cross-book synthesis**: the author's doctrines, motifs, obsessions, oppositions — i.e. *thinking that spans several works*. (E.g. for Voltaire: *optimisme*, *tolérance*, *providence*.)
- `entities/` — people, places, works, events (**default type set includes `work`** — useful: pages for the author's own books, cross-linked to concepts).
- `explorations/` — curated syntheses, e.g. "réponses de l'auteur à la question de la liberté" reusable by the bridge (see §9.4).
- Frontmatter `type:` must stay OKF-valid; do not alter the mechanical conventions (index.md, log.md formats).

`--refresh-schema` backs up the previous `AGENTS.md` when templates evolve (`AGENTS.md.bak`).

### 5.4 Update semantics

| Event | Action | Effect |
|---|---|---|
| New work registered for an author | ingest (§5.2) → `openkb add` → export → bump `kbVersion` | pack gains sentences/formulas; concept pages updated cross-book |
| Work removed | `openkb remove <work>` (+ `lint`) → export | pages sourced solely by it are deleted; links cleaned |
| Pipeline/prompt change | `openkb recompile --all --refresh-schema` → export | wiki regenerated (manual edits to generated pages are overwritten — by design) |
| New author | init KB → ingest ≥ 5 works → export | author onboarded without manual corpus surgery (replaces the harvest-only flow) |
| Failure mid-build | keep the previous pack; mark work `status:"failed"` | never publish an empty or partial pack (principle "jamais de trou") |

### 5.5 What the KB gives us beyond today's corpus

- **Cross-book synthesis** — a concept page aggregates what *Candide*, the *Dictionnaire philosophique* and the *Lettres* say about optimism. This is exactly "1 author = sum of his books".
- **Retrieval by reasoning over structure** (PageIndex trees → chapters → passages) instead of bag-of-terms overlap.
- **Entities** — the author's world (people, cities, works) reconciled across books; can also enrich the existing knowledge graph (`knowledge.ts` node kinds `dossier/auteur/prise/concept/oeuvre` align well).
- **Traceability** — every wiki page lists its `sources:`; every sentence can be traced back to a work and locus.

---

## 6. "Formulas" — the author's genuine formulations

### 6.1 Definition

A **formula** (`formule`) is a reusable unit of the author's voice extracted from the registered books, in two kinds:

| Kind | What it is | Used for |
|---|---|---|
| `verbatim` | A **whole sentence** (40–320 chars) copied exactly from a registered work, cleaned of OCR/editorial residue, with provenance | the *ancrage* — the single quotable sentence of a turn; also candidate short aphorisms |
| `pattern` | A recurring **construction** mined across the books (e.g. *maxime puis coût*, *Si… alors…*, concessive chains, opening/closing habits), with attested examples and counts | style fidelity of the *generated* sentences (never quoted, never attributed as citation) |

Guard: a pattern is *authorial* only if attested in ≥ 2 works; otherwise it is tagged `work-specific`.

### 6.2 Mining pipeline

1. **Sentence bank** — from KB sources (normalized text), extract whole sentences; reuse `sentencesOf()` + cleaning rules; reject: mid-word starts, ALL-CAPS/editorial noise (existing `NOISE` regex), < 40 chars, > 320 chars, numeric/table residue.
2. **Tags** — per sentence: `work`, `locus` (chapter / PageIndex node), `lang`, `domain[]` (the 16 domains + FR/EN keys of `salon-engine.js`), `demand[]` (definition/cause/manière/norme/vérité/quantité/valeur/thèse), `concepts[]` (from the KB's concept pages matched in the sentence, plus the deterministic `conceptsIn()` of `knowledge.ts`).
3. **Patterns** — deterministic n-gram / punctuation-rhythm statistics + optional LLM pass over the sentence bank; keep statistics (`attested`, `worksSpan`, examples).
4. **Quality gates** — every `verbatim` formula must pass `substringOk` (exact match after canonical normalization — whitespace, quotes, dashes) against its source text; otherwise it is dropped from the quotable set (it may survive as `pattern` evidence only).

### 6.3 Record schema

```json
{
  "id": "voltaire.f.v0042",
  "kind": "verbatim",
  "text": "…whole sentence…",
  "work": "Candide",
  "locus": { "chapter": "XXX", "node": "…", "href": "wiki/sources/candide" },
  "lang": "fr",
  "tags": { "domain": ["providence"], "demand": ["cause", "these"], "concepts": ["optimisme"] },
  "quality": { "substringOk": true, "chars": 187 },
  "kbVersion": "voltaire@2026-10-03T02:10:00Z"
}
```

`pattern` formulas replace `text`/`work` by `shape`, `examples[]`, `attested`, `worksSpan`.

### 6.4 Selection at reply time (deterministic)

```
score = relevance(queryTerms, formula)
      × contextFit(tags, scope.domain, scope.demand)
      × novelty(formula, last K turns, selfByAuthor)
      × workDiversity(prefer underused works)
```
Tie-break: stable id order (reproducible). At most **one** `verbatim` formula anchors a turn (contract §3 of `SALON-AGENT-AUTEUR.md`); `pattern` formulas inform phrasing only.

### 6.5 Why this answers the request

- "Coherent sentences depending on the context" → retrieval conditioned on question/tweet (§7).
- "Formulas genuinely made from the authors' books and their style" → verbatim formulas are exact sentences from the books; patterns are attested constructions; nothing is invented.
- "Reflecting their thinking" → selection is biased by the KB's concept pages (the author's own doctrines, aggregated across all his books).

---

## 7. Context & coherence — query construction

### 7.1 Inputs (Salon already has all of them)

| Input | Source | Use |
|---|---|---|
| Table question | `SalonRoom.question` | the horizon — never leaves the query |
| Last *prise* / last turn | `threadHistory` (≤ 12), `selfByAuthor` (≤ 8) | what this turn answers ("ressaisir") |
| Speech act + recipient | `planTurn` (`ouvre/objecte/précise/minute/ajoute`), `toName` | objection ⇒ aim at the addressee's claim; elenchus ⇒ definition-question |
| Demand / domain | `scope(question)` | retrieval facets |
| Gazette post text | `salon-x` (GET /2/tweets of the pasted post) | the tweet becomes the table question's annex |

### 7.2 Query template (bridge-side)

```
Retrieval query for kb "salon-<author>":

  [Question de table] « <question> »
  [Point à traiter] <toName> soutient : « <last prise or instructing claim> »
  [Acte] <réponse|objection|elenchus>
  [Cadre] demande : <demand> ; domaine : <domain> ; concepts : <…>
  [Contexte] (Gazette) « <tweet text> » / (fil) <last 3 turns, prises only>

  Objectif : trouver (1) les passages qui répondent à CE point précis,
  dans l'union des œuvres de l'auteur ; (2) les formules verbatim candidates ;
  (3) l'aveu du manque si rien ne répond.
```

Notes:
- Keep it **deterministic** (string template, no free paraphrase) so runs are reproducible and testable.
- `k=3` passages by default; dedupe by `id`; prefer distinct works when scores tie.
- The reply language stays the question's language; citations stay the book's language.

### 7.3 Modes

| Mode | Endpoint use | Returns | When |
|---|---|---|---|
| `retrieval` (default) | OpenKB used as memory: passages/sentences retrieved via the KB (PageIndex) with facets | 2–3 whole sentences + formula candidates + trace | every turn; cheap, central to the contract |
| `answer` | OpenKB `query` (one-shot, grounded synthesis) | a short synthesis + passages | long questions, `Explorations`, FAQ-ish turns; the composer re-cuts it to PRISE/RÉPLIQUE |
| `offline` | none (static) | pack retrieval with the enhanced scoring | server down / no key / latency budget exceeded |

### 7.4 Cross-language (FR question ↔ EN book)

Two complementary levers, decided per pilot:
1. **Query-side translation only** (never citations): translate the assembled query to the KB's language via the existing LLM relay, or
2. **Bilingual keys**: enrich `scope.keys` with EN synonyms so the lexical part also hits; plus the KB facets carry concept ids that already unify languages.
Citations remain strictly in the original book language; UI glosses (if any) must be visually distinct from quotes.

---

## 8. Data contracts

### 8.1 Salon pack (canonical, per author)

```json
{
  "authorId": "voltaire",
  "kbVersion": "voltaire@2026-10-03T02:10:00Z",
  "builtAt": "2026-10-03T02:14:12Z",
  "lang": "fr",
  "works": [ { "title": "Candide", "url": "…", "hash": "sha256:…", "sentences": 64 } ],
  "passages": [ { "id": "voltaire.s0231", "w": "Candide", "s": "…whole sentence…",
                  "src": { "chapter": "XXX", "node": "…" }, "tags": { "domain": ["…"], "demand": ["…"], "concepts": ["…"] } } ],
  "formulas": [ { "id": "…", "kind": "verbatim", "…": "…" } ],
  "concepts": [ { "id": "optimisme", "label": "Optimisme", "gist": "…", "page": "concepts/optimisme" } ],
  "entities": [ { "id": "pangloss", "type": "person", "label": "Pangloss" } ],
  "stats": { "sentences": 342, "formulas": 88, "works": 5 },
  "checksum": "sha256:…"
}
```

### 8.2 Compatibility with today's consumers — **additive only**

- The static engine reads `p.w || p.work`, `p.t || p.text || p.s`, `p.s || bestSentence(text)` — so `{w, s, + extra fields}` keeps working unchanged. Do **not** introduce a `t` field. Extra fields (`src`, `tags`, `id`) are ignored by the current engine and used by the upgraded scorer.
- The SPA lib reads `{ passages: [{id, work, text, terms}], terms, sample }` — export produces this projection too; `text` stays a whole sentence (it already is in the new pipeline).
- `SalonTurn.citations` (`{work, text}`) stays; add optional `ref: {passageId, formulaId, kbVersion}` for observability (safe additive change).

### 8.3 Published artifacts (static)

```
backend/web/public/salon/
  corpus.json          # enhanced, legacy shape { "<author>": [ {w,s,id,src,tags} … ] }  ← merged packs
  formulas.json        # { "<author>": [ …formula records… ] }
  kb/<authorId>.json   # full pack per author (source for the above projections)
  kb-manifest.json     # versions, checksums, counts, build log summary
```

The SPA-side `salon/src/lib/salon/corpus.json` is regenerated from the same packs (one canonical build → two projections; never fork the data).

### 8.4 Bridge contracts

`KbQueryRequest` (see §9.2) → `KbQueryResponse`:

```json
{
  "ok": true,
  "mode": "retrieval",
  "kbVersion": "voltaire@2026-10-03T02:10:00Z",
  "passages": [ { "id": "voltaire.s0231", "work": "Candide", "sentence": "…", "score": 0.42,
                  "weak": false, "src": { "chapter": "XXX" } } ],
  "formulas": [ { "id": "voltaire.f.v0042", "text": "…", "work": "Candide" } ],
  "synthesis": null,
  "trace": { "id": "tr_01J…", "ms": 812, "engine": "openkb", "steps": ["scope", "kb.query", "rank"] }
}
```

---

## 9. Interfaces

### 9.1 OpenKB REST (server-side only; loopback)

| Need | Endpoint | Notes |
|---|---|---|
| Create author KB | `POST /api/v1/init` | `{kb:"salon-voltaire", model?, api_key?, openai_api_base?}`; writes KB-local `.env` |
| Ingest a work | `POST /api/v1/add` | multipart (`kb`, `files[]`, `stream`); SSE events `uploaded/file_start/file_done` |
| Grounded synthesis | `POST /api/v1/query` | `{kb, question, stream:true, save:false}`; SSE `delta/tool_call/final` |
| Inventory / health | `POST /api/v1/list` · `POST /api/v1/status` · `POST /api/v1/lint` | per-KB stats; lint report also written to `wiki/reports/` |
| Maintenance | `POST /api/v1/remove` · `POST /api/v1/recompile` | doc or `all_docs`; `dry_run` supported |
| Incremental drop-in | `POST /api/v1/watch/start` (raw/) | optional; pairs with the nightly sync |

Auth when `OPENKB_API_TOKEN` set: `Authorization: Bearer <token>` — mandatory in our deployment. Never expose the OpenKB port beyond `127.0.0.1`.

### 9.2 New Salon bridge (Fastify module)

New files: `backend/fastify/lib/salon-kb.mjs` (client + logic), `backend/fastify/routes/salon-kb.mjs` (HTTP). Same auth as the rest of `/v1/*` (Bearer Salon; SSO on the client side).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/v1/salon/kb/query` | `{ authorId, question, context:{ turns:[{name,prise,text}], act, toName, tweet?, instruction? }, mode:"retrieval"\|"answer", k? }` | `KbQueryResponse` (§8.4); JSON or SSE (`stream:true`) |
| POST | `/v1/salon/kb/speak` | same + `{ patch?, figure? }` | `{ prise, replique, grounded, sources:[…], engine:"salon", fallback:bool }` — full turn under the PRISE/RÉPLIQUE contract (server-side compose with KB memory) |
| GET | `/v1/salon/kb/manifest` | — | `kb-manifest.json` snapshot (versions per author) |
| GET | `/v1/salon/kb/status/:authorId` | — | KB status + last lint + pack stats |
| POST | `/v1/salon/kb/sync` *(admin)* | `{ authorId?, changedOnly?:true }` | triggers the build pipeline (§10); returns job id |

Behavior requirements:
- **Timeout budget**: retrieval ≤ 6 s hard; answer ≤ 12 s; then degrade (`503`-free: return `ok:false, degraded:"timeout"` and let the client use packs).
- **Cache**: key = `sha1(authorId + kbVersion + normalized(question) + act + toName + hash(lastPrise) + hash(tweet))`; TTL 24 h; retrieval responses cacheable, `answer` responses cached but served only on identical context.
- **Circuit breaker**: after N consecutive failures, short-circuit to packs for `cooldownMs`; log `soft_error` (existing patterns of the backend).
- **No cross-author leakage**: a query only ever touches `salon-<authorId>`.

### 9.3 Client integration points

| File | Change |
|---|---|
| `circle-run.js` / `circle-speech.js` | when online and `salon_kb=1`: memory block comes from `/v1/salon/kb/query`; keep the existing fallback `SalonEngine.answer` unchanged. `floorPrompt` keeps its contract; passages gain `src` info. |
| `salon-engine.js` | optional scoring upgrade: consume `tags`/`src`; keep `retrieve()` signature & determinism. |
| `speak.ts` | replace the local `passages.slice(0,3)` with bridge passages when available; otherwise unchanged. `pickGrounding()` unchanged (still the weak/strong gate). |
| `catalog.ts` / `memory.ts` | load packs when present (`kb-manifest.json` check → `kb/<author>.json`), fallback to legacy corpus. |
| `gazette-desk.js` / `flux-x.js` | attach the pasted post text to the bridge call (`context.tweet`); **mention gate, 45 s, idempotence, 24 h retract unchanged**. |

### 9.4 Explorations (optional, P2)

`explorations/` pages persisted with `openkb query --save` (or via lint/recompile flows) accumulate salon-useful syntheses ("réponses de X sur la liberté"). The bridge may surface one as a *candidate synthesis* when the context matches — still re-cut by the composer and re-grounded before quoting. Human-curated only; never saved from live user threads without consent.

---

## 10. Build & sync pipeline

New scripts (to implement, in the spirit of `harvest_corpus.mjs` — deterministic, "jamais de trou"):

| Script | Role |
|---|---|
| `salon/scripts/openkb_ingest.mjs` | fetch + normalize + package a work → `raw/<work>.pdf` (or chapter MDs); writes the work record (hash) into `kb-map.json`. |
| `salon/scripts/openkb_sync.mjs` | orchestrator: for each author — ensure KB (`init` if missing) → diff works (hash) → `add` missing → `recompile` when schema changed → call export → update manifests. `--changed-only`, `--author <id>`, `--dry-run`. Single-writer lock (§11.3). |
| `salon/scripts/kb_export.mjs` | reads `wiki/` + `sources/` (+ sentence bank) → emits the Salon packs & projections (§8.3) → writes `kb-manifest.json`; runs the pack validator (§12) before publishing. |
| `salon/scripts/kb_quote_audit.mjs` | batch audit: every `verbatim` formula substring-verified against its work; report to `docs/reports/`. |

Reference orchestration (sketch):

```js
// salon/scripts/openkb_sync.mjs — reference sketch (not final code)
// 1. lock (single writer)
// 2. read catalog.json + authors-pack.json + kb-map.json
// 3. for each author:
//    a. ensureOpenKb("salon-"+id)            // POST /api/v1/init (idempotent)
//    b. for each registered work:            // union of works[] (ok:true) + extras
//         if hash unchanged → skip
//         else ingestWork(work)              // normalize → raw/<work>.pdf → POST /api/v1/add
//    c. if schemaChanged → POST /api/v1/recompile {all_docs:true, refresh_schema:true}
//    d. POST /api/v1/lint  (collect report)
// 4. kb_export.mjs --all                     // wiki → packs → public/salon/
// 5. update manifests; unlock; publish summary
```

Cadence: nightly `--changed-only`; full recompile on OpenKB upgrades; manual `sync --author …` when an author page gains works.

---

## 11. Operations

### 11.1 Deployment (OVH VPS, alongside the Fastify backend)

```bash
# one-time
python3 -m venv /srv/openkb-venv
/srv/openkb-venv/bin/pip install "openkb[web]"==<pinned>
# service (systemd preferred; pm2 is at home with Node, OpenKB is Python)
# /etc/systemd/system/openkb.service:
#   ExecStart=/srv/openkb-venv/bin/openkb-web --host 127.0.0.1 --port 7566
#   EnvironmentFile=/etc/openkb/env        (0600: OPENKB_API_TOKEN, OPENKB_KB_ROOT)
#   Restart=on-failure
```

- `OPENKB_KB_ROOT=/srv/openkb/kbs` · `OPENKB_API_TOKEN` (sealed; also written to the backend `.env` for the bridge).
- Extend the existing deploy workflow (`deploy-vps-backend.yml`) to (re)install/refresh OpenKB and restart the unit; new GitHub secrets: `OPENKB_API_TOKEN`.
- The OpenKB port is **loopback only**; the Workbench UI is for operators (SSH tunnel).

### 11.2 Per-KB configuration (`.openkb/config.yaml`)

```yaml
model: mistral/mistral-medium-latest   # any LiteLLM id; validate at M0 (compile quality matters)
language: fr                            # wiki output language — set to the author's primary language
pageindex_threshold: 20
# entity_types: defaults include person/organization/place/product/work/event — keep, they fit
```

Compile model choice is a decision (§14): compile runs are rare (per book/change) and quality compounds; query runs are frequent.

### 11.3 Concurrency, locks, failure

- One writer per KB: sync takes a lock file (`.kb.lock`); concurrent syncs are refused, not merged.
- OpenKB has its own ingest lock; `add`/`remove`/`recompile` are serialized server-side.
- On failure: keep the previous pack/manifest untouched; mark the author `degraded` in `kb-manifest.json`; the app keeps serving the previous version (never a hole).
- Backups: nightly tar of `/srv/openkb/kbs/salon/` (raw + wiki state) — mostly for latency (everything is rebuildable from sources).

### 11.4 Monitoring

- `GET /v1/salon/kb/manifest` + `/status/:authorId` exposed to the app's ops panel.
- Metrics: build duration per author, sentence/formula counts, lint findings, bridge p95, cache hit rate, fallback rate.
- Logs: keep `wiki/reports/lint_*.md` history; a monthly drift audit (`kb_quote_audit.mjs`).

---

## 12. Verification & acceptance

### 12.1 Tests to add (mirroring `tests/salon-engine.test.mjs`)

| Test file | Covers |
|---|---|
| `tests/salon-openkb.test.mjs` | published packs: schema; bounded sentences (40–320); provenance; uniqueness; corpus ↔ pack correspondence; formulas (exact verbatim, attested patterns); canonicalization. |
| `backend/fastify/tests/salon-kb.test.mjs` | bridge: context-conditioned query, ranking, cache, circuit breaker, `ok:false` degradation, routes `/v1/salon/kb/*` (auth, 400/404). |
| `tests/salon-engine.test.mjs` | **unchanged** — the 10 deterministic tests must stay green with v2 packs (extends fixtures). |

### 12.2 Acceptance criteria (pilot, then all authors)

1. Golden set: 20 questions + 20 Gazette-style post contexts across ≥ 8 authors.
2. Turn quality: ≥ 90 % "on-question" (two blind raters; adjudication on disagreement).
3. Quotes: 100 % substring-verified in an audit of 200 sampled turns; **0 invented works**.
4. Style: blind pairwise vs current pipeline — ≥ 70 % preference on pilot authors.
5. Latency (staging): retrieval cached ≤ 1.5 s p95; uncached ≤ 6 s; answer ≤ 12 s; degradation path exercised in tests.
6. Rebuild: adding one work to one author updates pack ≤ 30 min incremental; removing it cleans wiki (lint 0 broken links).
7. Compliance: no tweet text persisted in KBs; mention gate & rate rules unchanged (regression test on `salon-x` suite).

---

## 13. Risks & mitigations

| Risk | Level | Mitigation |
|---|---|---|
| OpenKB is young and moves fast | med | pin version (`pip …==`), wrap behind the bridge, keep pack format as *our* contract; upgrade = re-run sync + validator |
| Long non-PDF books not yet first-class | med | package as PDF (preferred) or chapter-split MD; validate on M0; track roadmap item |
| Compile cost / latency (LLM) | med | rare runs, `--changed-only`, cheaper model for query vs compile; batch at night |
| Retrieval still misses (semantic gaps) | low-med | facets + concept tags + bilingual keys; `weak` gate + avowal as backstop; optional embeddings later (`/v1/embed`) |
| Determinism expectations vs LLM paths | med | packs are the deterministic substrate; online path cached & versioned; every reply records engine + kbVersion |
| Quote drift (LLM paraphrasing a quote) | high impact | finish check in composer (substring verifier), quote audit, `aveu du manque` policy |
| X compliance regression | high impact | tweets never ingested; context passed transiently per request; keep SALON-X tests; update `SALON-X-API-USAGE.md` if scope changes |
| Storage growth | low | text-only KBs (MBs/author); wiki is markdown; backups bounded |
| OCR scans (some works) | low | PageIndex Cloud OCR optional (`PAGEINDEX_API_KEY`) — only for scanned books |
| Single VPS failure | med | packs are static → app degrades gracefully; OpenKB restart policy; rebuild from sources |

---

## 14. Rollout & open decisions

### 14.1 Milestones

| M | Content | Exit |
|---|---|---|
| **M0 — spike** (2–3 d) | OpenKB on staging; pilot author KB (suggest **Voltaire** — FR, many works, visible in demos); validate PDF packaging, compile model, query quality | 3 questions answered from KB with valid citations |
| **M1 — packs + bridge (pilot)** | ingest/export/sync scripts; bridge routes; app reads packs behind `salon_kb`; golden set v1 | acceptance §12.2 items 2–5 on 2 authors (1 FR, 1 EN — e.g. Smith) |
| **M2 — all authors + Gazette** | batch build 54 authors; Gazette context assembly; observability; A/B vs current | all authors `packs ok`; Gazette regression tests green |
| **M3 — self-serve** | new-author flow (`CreateAuthor`) → auto KB build; optional Skill Factory (`openkb skill new <author>-voice`) for `/salon/agents`; optional `visualize` graph in the fiche | onboarding ≥ 5 works → pack in ≤ 1 h |

### 14.2 Open decisions (owner: product/tech)

1. **Compile model** per KB (quality vs cost) — decide after M0 comparison.
2. **Pilot authors** — Voltaire + one English author recommended.
3. **Pack publishing** — static mirror (recommended, zero-latency) vs API-only.
4. **`harvest_corpus.mjs`** — keep as fallback generator for two green cycles, then mark deprecated (do not delete).
5. **Formula curation** — who reviews the top formulas per author (initial audit by the salon team, then spot checks).
6. **Explorations** — whether/when `--save` answers re-enter KBs (never from live user threads without consent).

---

## 15. Appendices

### A. Mapping — today → after

| Today | After | Notes |
|---|---|---|
| `corpus.json` (fragments; two shapes) | `kb/<author>.json` packs → projections (`corpus.json`, `formulas.json`) | additive fields; legacy shapes preserved |
| `harvest_corpus.mjs` (fetch+cut+sample, direct write) | ingest step (fetch+normalize+package) + export step (wiki→pack); harvest kept as fallback | same deterministic principles |
| `salon-engine.js` `retrieve()` | same interface; richer records, optional tag-aware scoring | engine contract & 10 tests unchanged |
| `speak.ts` local passages | bridge passages (or packs offline) | PRISE/RÉPLIQUE contract unchanged |
| `/v1/demo/chat` relay | unchanged | bridge is a separate, dedicated route |
| `catalog.json` | unchanged — remains the registry of "registered books" | KBs/packs are derived |
| `authors-pack.json` | unchanged (+ `kb-map.json` generated) | methods untouched |

### B. Example pack (abridged, fictional values)

See §8.1. One sentence, one formula, one concept. **No quotation in this document is real** — placeholders only.

### C. Fastify bridge sketch

```js
// backend/fastify/lib/salon-kb.mjs — reference sketch
const OPENKB = process.env.OPENKB_URL || 'http://127.0.0.1:7566';
const TOKEN  = process.env.OPENKB_API_TOKEN;

export async function kbQuery({ authorId, question, context, mode = 'retrieval', k = 3 }) {
  const kb = `salon-${authorId}`;
  const q  = buildQuery(question, context);            // §7.2 template
  if (mode === 'retrieval') {
    const res = await fetch(`${OPENKB}/api/v1/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ kb, question: q, stream: false, save: false }),
      signal: AbortSignal.timeout(6000),
    });
    const body = await res.json();                    // answer + trace
    return { ok: true, mode, answer: body.answer, trace: body };
  }
  /* answer mode: same call, stream:false; composer re-cuts */
}
```

```js
// backend/fastify/routes/salon-kb.mjs — reference sketch
export default async function salonKbRoutes(app) {
  app.post('/v1/salon/kb/query', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me) return;
      const { authorId, question, context = {}, mode, k } = req.body || {};
      if (!authorId || !question) return reply.code(400).send({ ok: false, error: 'authorId and question required' });
      try {
        const out = await app.kayrosContext.salonKb.query({ authorId, question, context, mode, k });
        return out;
      } catch (e) {
        app.log.warn({ err: e }, 'salon-kb degraded');
        return { ok: false, degraded: 'timeout' };   // client falls back to static packs
      }
    });
}
```

### D. References

- OpenKB — <https://github.com/VectifyAI/OpenKB> (README, `examples/rest-api/README.md`, `docs/golden-principles.md`)
- PageIndex — <https://github.com/VectifyAI/PageIndex> · <https://docs.pageindex.ai>
- OKF (Google Open Knowledge Format) — linked from OpenKB README
- Salon: `SALON.md`, `SALON-AGENT-AUTEUR.md`, `SALON-MOTEUR-DETERMINISTE.md`, `SALON-X.md`, `SALON-X-API-USAGE.md`
- Code anchors: `backend/web/public/salon/salon-engine.js` (`scope/retrieve/compose/bestSentence`), `salon/src/lib/salon/reflect.ts` (`composeFromMemory`), `speak.ts`, `harvest_corpus.mjs`, `align_corpus.mjs`

### E. Definition of done (this integration)

- [ ] All authors have a KB and a validated pack; manifest published.
- [ ] App reads packs (static path) with zero regressions on `salon-engine` tests.
- [ ] Bridge live on staging: retrieval cached ≤ 1.5 s p95; degradation path tested.
- [ ] Golden-set acceptance §12.2 met on pilot authors; audit reports archived.
- [ ] Gazette replies still mention-gated; no tweets in KBs (compliance test).
- [ ] Runbook: rebuild one author / one work; restore previous pack; upgrade OpenKB.

### F. Langues (v2 — « jamais de mélange »)

- Le corpus porte `tr: { fr?, en? }` : la traduction d'affichage de chaque phrase (l'original
  reste dans `s`, base des scores de recherche). Les packs et le corpus publié transportent `tr`.
- `salon-engine.js` affiche la langue choisie partout : répliques, passages du prompt, ancres
  de doctrine (`resolveAnchor(..., lang)`), preuves des auteurs importés (`sampleFr`/`sampleEn`).
- Import d'auteur : les six œuvres sont traduites (fr/en) AVANT enregistrement via
  `POST /v1/salon/translate` (cache, garde anti-`[mock]`) ; résumé Wikipédia bilingue (blurbFr/blurbEn).
- Import au runtime : la route sert de rattrapage pour toute donnée future (fournisseur LLM forcé côté serveur).
