import { z } from 'zod';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { findAuthor, findAuthorByName, searchAuthors, stripGutenbergBoilerplate, literaryFingerprint, normTitleLite } from '../lib/literary-catalog.mjs';
import { searchAllSources, workTextFromUrl, SOURCES_DIRECTORY } from '../lib/literary-sources.mjs';
import { applyBookPolicy, scoreWorkAgainstAgent, pickBestAgentForWork, appendLedgerEntry, readLedgerEntries } from '../lib/literary-ledger.mjs';

const USER_AGENT = 'KayrosLab/1.0 (literary personality corpus; +https://www.kayroslab.com)';
const WORK_CHAR_LIMIT = 900_000;
const TOTAL_CHAR_LIMIT = 4_500_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BOOKS_PER_AGENT = Number(process.env.KAYROS_AUTHOR_MAX_BOOKS || 15);
const MIN_BOOKS_PER_AGENT = Number(process.env.KAYROS_AUTHOR_MIN_BOOKS || 3);
const AUTHOR_TARGET_BOOKS = Number(process.env.KAYROS_AUTHOR_TARGET_BOOKS || 5);
const LEDGER_FILE = path.join(process.cwd(), 'data', 'literary', 'ledger.jsonl');

const createAgentSchema = z.object({
  display_name: z.string().trim().min(1).max(160).optional(),
}).optional().default({});

const worksAgentSchema = z.object({
  display_name: z.string().trim().min(1).max(160),
  works: z.array(z.object({
    title: z.string().trim().min(1).max(240),
    url: z.string().url().max(1000),
    author: z.string().trim().max(200).optional(),
    source: z.string().trim().max(80).optional(),
  })).min(1).max(15),
}).optional().default({});

const addBooksSchema = z.object({
  works: z.array(z.object({
    title: z.string().trim().min(1).max(240),
    url: z.string().url().max(1000),
    author: z.string().trim().max(200).optional(),
  })).min(1).max(6),
});

async function fetchWorkText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/plain,text/html,application/epub+zip,application/json,*/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const charset = (response.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(buffer); }
  catch { text = new TextDecoder('utf-8').decode(buffer); }
  return text;
}

async function fetchAvatar(wikipedia) {
  try {
    const response = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(wikipedia).replace(/ /g, '_'))}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.thumbnail?.source || data?.originalimage?.source || null;
  } catch { return null; }
}

async function fetchAvatarForName(name) {
  try {
    const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&formatversion=2&origin=*`;
    const response = await fetch(searchUrl, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const data = await response.json();
    const title = data?.query?.search?.[0]?.title;
    return title ? fetchAvatar(title) : null;
  } catch { return null; }
}

function extractVoiceSample(text) {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s+/g, ' ').trim());
  const candidates = paragraphs.filter((paragraph) => paragraph.length >= 160 && paragraph.length <= 3000);
  const pick = candidates[Math.floor(candidates.length / 4)] || candidates[0] || paragraphs.find(Boolean) || '';
  return pick.slice(0, 340);
}

function buildPersona(authorLike, loaded, stats) {
  const titles = loaded.map((work) => `« ${work.title} » (${work.chars} signes)`).join(' ; ');
  const parts = [
    `Tu incarnes ${authorLike.name} (${authorLike.era}), ${authorLike.kind}. Ta connaissance et ta voix viennent exclusivement de la somme de tes œuvres du domaine public chargées pour toi.`,
    `Œuvres chargées : ${titles || 'aucune pour le moment'}.`,
    `Règles : (1) n'invoque aucune œuvre hors de cette liste et n'invente ni citation ni fait biographique — ce qui manque devient une hypothèse explicite ; (2) réponds dans la langue de la question, avec la voix de l'échantillon ci-dessous (ton, rythme, vocabulaire), sans parodier ; (3) ton jugement sur une décision vient de ta sensibilité et de tes thèmes, pas de l'opinion d'un comité ; (4) tu restes un agent du collectif : rends verdict, objections et conditions dans le format attendu.`,
    loaded[0]?.sample ? `Échantillon de voix : « ${loaded[0].sample} »` : 'Échantillon de voix : corpus vide — réponds en hypothèses explicites.',
    `Empreinte lexicale de la somme des œuvres (${stats.words} mots analysés, ${stats.distinct} termes distincts) : ${stats.terms.join(', ')}.`,
  ];
  const persona = parts.join('\n');
  return persona.length > 4000 ? `${persona.slice(0, 3999)}…` : persona;
}

async function saveCorpus(agentId, texts) {
  try {
    const directory = path.join(process.cwd(), 'data', 'literary');
    await fsPromises.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${agentId}.json`);
    await fsPromises.writeFile(file, JSON.stringify({ agent_id: agentId, texts }, null, 0), 'utf8');
    return file;
  } catch { return null; }
}

async function loadCorpus(agentId) {
  try {
    const file = path.join(process.cwd(), 'data', 'literary', `${agentId}.json`);
    const data = JSON.parse(await fsPromises.readFile(file, 'utf8'));
    return Array.isArray(data.texts) ? data.texts : [];
  } catch { return []; }
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'auteur';
}

function normTitle(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Télécharge les œuvres choisies (txt/html/epub) et produit texte nettoyé + manifeste (avec empreinte et voix par œuvre). */
async function ingestSelectedWorks(works) {
  const manifest = [];
  const texts = [];
  const loaded = [];
  let total = 0;
  for (const work of works) {
    if (total >= TOTAL_CHAR_LIMIT) { manifest.push({ title: work.title, url: work.url, author: work.author || '', source: work.source || '', ok: false, error: 'quota de taille atteint' }); continue; }
    try {
      const raw = await fetchWorkText(work.url);
      const { text: converted, kind } = await workTextFromUrl(work.url).catch(() => ({ text: raw, kind: 'txt' }));
      const clean = stripGutenbergBoilerplate(converted || raw).slice(0, WORK_CHAR_LIMIT);
      if (clean.length < 200) throw new Error('contenu trop court');
      total += clean.length;
      texts.push(clean);
      const perWork = literaryFingerprint([clean]);
      const entry = { title: work.title, url: work.url, author: work.author || '', source: work.source || '', ok: true, kind, chars: clean.length, terms: perWork.terms.slice(0, 20).map((term) => term.split(' ')[0]), sample: extractVoiceSample(clean) };
      manifest.push(entry);
      loaded.push({ title: work.title, chars: clean.length, sample: entry.sample });
    } catch (error) {
      manifest.push({ title: work.title, url: work.url, author: work.author || '', source: work.source || '', ok: false, error: String(error.message || error) });
    }
  }
  return { manifest, texts, loaded, total };
}

function agentLite(agent) {
  return { agent_id: agent.agent_id, display_name: agent.display_name, role_name: agent.role_name, department: agent.department, metadata: agent.metadata, enabled: agent.enabled };
}

export default async function literaryRoute(app) {
  // Catalogue public des auteurs du domaine public (consulté depuis la console).
  app.get('/v1/literary/authors', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const authors = searchAuthors({ search: req.query?.search, kind: req.query?.kind, lang: req.query?.lang });
    return { authors, kinds: ['philosophe', 'écrivain', 'dramaturge', 'poète', 'essayiste', 'savant', 'économiste'] };
  });

  // Sources de livres (annuaire intégré : Bookatomy, NosLivres/efele, EbooksGratuits, Gutenberg, Wikisource…)
  app.get('/v1/literary/sources', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return {
      sources: SOURCES_DIRECTORY,
      searchable: ['gutenberg', 'efele (NosLivres)', 'ebooksgratuits', 'wikisource fr', 'wikisource en'],
      ingestable_formats: ['txt', 'html', 'epub'],
      limits: { books_per_agent_max: MAX_BOOKS_PER_AGENT, books_per_agent_min: MIN_BOOKS_PER_AGENT, rooms_per_user: Number(process.env.KAYROS_MAX_ROOMS_PER_USER || 3), built_agents_per_room: Number(process.env.KAYROS_MAX_BUILT_AGENTS_PER_ROOM || 3) },
    };
  });

  // Recherche temps réel dans les sources en ligne
  app.get('/v1/literary/search', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const query = String(req.query?.q || '').trim();
    if (query.length < 2) return reply.code(400).send({ error: 'requête trop courte (2 caractères minimum)' });
    try { return await searchAllSources(query, { limitPerSource: 6 }); }
    catch (error) { return reply.code(502).send({ error: error.message }); }
  });

  // Création d'un agent auteur du catalogue : somme des œuvres trouvées en ligne + politique 15/3 + registre.
  app.post('/v1/literary/authors/:authorId/agent', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = createAgentSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'corps invalide', issues: parsed.error.issues });

    const author = findAuthor(req.params.authorId);
    if (!author) return reply.code(404).send({ error: 'auteur introuvable dans le catalogue du domaine public' });

    const agentId = `auteur_${author.id}`;
    const existing = app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId }).find((agent) => agent.agent_id === agentId);
    if (existing) return reply.code(409).send({ error: `l'agent auteur « ${agentId} » existe déjà dans ce tenant` });

    // 1. Pool = œuvres du catalogue + enrichissement temps réel (recherche du nom d'auteur).
    const pool = author.works.map((work) => ({ title: work.title, url: work.url, author: author.name, source: 'catalogue vérifié' }));
    const surname = (author.name.split(/[ ,]+/).filter((word) => word.length > 3).pop() || author.name).toLowerCase();
    try {
      const live = await searchAllSources(author.name, { limitPerSource: 12 });
      for (const group of live.sources) {
        for (const result of group.results || []) {
          if (!result.ingestable) continue;
          const hay = `${result.title} ${result.author}`.toLowerCase();
          if (!hay.includes(surname)) continue;
          if (pool.some((work) => normTitle(work.title) === normTitle(result.title))) continue;
          pool.push({ title: result.title, url: result.url, author: result.author || author.name, source: group.source });
        }
      }
    } catch { /* l'enrichissement temps réel reste au mieux : les œuvres du catalogue suffisent */ }

    // 2. Politique 15/3 (cap / plancher / repli manuel).
    const policy = applyBookPolicy(pool.length, { max: MAX_BOOKS_PER_AGENT, min: AUTHOR_TARGET_BOOKS });
    const assignedWorks = pool.slice(0, policy.assign);

    // 3. Ingestion des œuvres assignées.
    const ingestion = await ingestSelectedWorks(assignedWorks);
    if (!ingestion.texts.length) {
      // Aucune œuvre lisible : on crée quand même l'agent (persona catalogue) et on propose l'ajout manuel.
      const persona = `Tu incarnes ${author.name} (${author.era}), ${author.kind}. Aucune œuvre n'a encore été chargée : annonce explicitement que ton corpus est vide et réponds en hypothèses explicites.`;
      const avatarUrl = await fetchAvatar(author.wikipedia);
      const definition = {
        agent_id: agentId, display_name: parsed.data.display_name || author.name,
        role_name: `${author.name} — ${author.kind}`.slice(0, 160), department: 'Bibliothèque du domaine public', seniority: 'executive',
        primary_focus: persona, mission: `Incarner ${author.name} et instruire la question posée strictement depuis ses œuvres du domaine public.`,
        instructions: 'Réponds dans la langue de la question. Marque explicitement toute hypothèse qui sort des œuvres chargées.',
        constraints: ['Ta connaissance se limite strictement aux œuvres du domaine public chargées pour toi.'],
        connectors: ['console'], enabled: true, veto_power: false,
        metadata: { literary: { author_id: author.id, name: author.name, kind: author.kind, era: author.era, lang: author.lang, avatar_url: avatarUrl, works: [], works_count: 0, terms: [], stats: { words: 0, distinct: 0 }, generated_at: new Date().toISOString() } },
        rule_configuration: { user_added_rules: [{ rule_id: 'AUTEUR_GROUNDING', rule_text: 'Toute affirmation hors des œuvres chargées doit être marquée comme hypothèse explicite.' }] },
      };
      const agent = app.kayrosContext.engine.swarm.createAgent(definition, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.();
      await appendLedgerEntry(LEDGER_FILE, { type: 'created', tenant: me.tenantId, agent_id: agentId, rule: 'catalogue', details: `${author.name} — 0 œuvre disponible` });
      await appendLedgerEntry(LEDGER_FILE, { type: 'floor-short', tenant: me.tenantId, agent_id: agentId, rule: `min ${MIN_BOOKS_PER_AGENT}`, details: `${ingestion.manifest.filter((w) => w.ok).length} œuvre(s) seulement — ajout manuel demandé` });
      return reply.code(201).send({
        agent: agentLite(agent), ingestion: { works: ingestion.manifest, assigned: 0, policy: { ...policy, max: MAX_BOOKS_PER_AGENT, min: MIN_BOOKS_PER_AGENT } },
        proposal: { manual_required: true, missing: MIN_BOOKS_PER_AGENT, message: `Seulement ${ingestion.manifest.filter((w) => w.ok).length} œuvre(s) disponible(s) pour ${author.name} — ajoutez des livres manuellement (l'IA les attribuera selon les caractéristiques de l'agent).` },
      });
    }

    const stats = literaryFingerprint(ingestion.texts);
    const avatarUrl = await fetchAvatar(author.wikipedia);
    const persona = buildPersona(author, ingestion.loaded, stats);
    const corpusFile = await saveCorpus(agentId, ingestion.texts);

    const definition = {
      agent_id: agentId,
      display_name: parsed.data.display_name || author.name,
      role_name: `${author.name} — ${author.kind}`.slice(0, 160),
      department: 'Bibliothèque du domaine public',
      seniority: 'executive',
      primary_focus: persona,
      mission: `Incarner ${author.name} et instruire la question posée strictement depuis ses œuvres du domaine public.`,
      instructions: 'Réponds dans la langue de la question. Cite l’œuvre d’où vient ton raisonnement quand c’est possible. Marque explicitement toute hypothèse qui sort des œuvres chargées.',
      constraints: [
        'Ta connaissance se limite strictement aux œuvres du domaine public chargées pour toi.',
        'N’invente ni citation ni fait biographique hors des œuvres chargées.',
      ],
      connectors: ['console'],
      enabled: true,
      veto_power: false,
      metadata: {
        literary: {
          author_id: author.id, name: author.name, kind: author.kind, era: author.era, lang: author.lang,
          avatar_url: avatarUrl, works: ingestion.manifest, works_count: ingestion.manifest.filter((work) => work.ok).length,
          terms: stats.terms.slice(0, 20).map((term) => term.split(' ')[0]), stats: { words: stats.words, distinct: stats.distinct },
          corpus_file: corpusFile, generated_at: new Date().toISOString(),
        },
      },
      rule_configuration: {
        user_added_rules: [
          { rule_id: 'AUTEUR_GROUNDING', rule_text: 'Toute affirmation hors des œuvres chargées doit être marquée comme hypothèse explicite.' },
          { rule_id: 'AUTEUR_CITATION', rule_text: 'Quand c’est possible, indique l’œuvre d’où vient ton raisonnement.' },
        ],
      },
    };

    try {
      const agent = app.kayrosContext.engine.swarm.createAgent(definition, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.();

      // 4. Registre d'ingestion (traçabilité complète).
      await appendLedgerEntry(LEDGER_FILE, { type: 'created', tenant: me.tenantId, agent_id: agentId, rule: 'catalogue', details: `${author.name} — ${ingestion.manifest.filter((work) => work.ok).length} œuvre(s) chargée(s)` });
      for (const work of ingestion.manifest.filter((entry) => entry.ok)) {
        await appendLedgerEntry(LEDGER_FILE, { type: 'assigned', tenant: me.tenantId, agent_id: agentId, book: work.title, url: work.url, rule: `source: ${work.source}`, details: `${work.chars} signes` });
      }
      if (policy.rule === 'cap') {
        await appendLedgerEntry(LEDGER_FILE, { type: 'cap', tenant: me.tenantId, agent_id: agentId, rule: `max ${MAX_BOOKS_PER_AGENT}`, details: `${policy.withheld} œuvre(s) retenue(s) au-delà du plafond` });
      }
      if (policy.rule === 'floor-ok' || policy.rule === 'floor-short') {
        await appendLedgerEntry(LEDGER_FILE, { type: policy.rule, tenant: me.tenantId, agent_id: agentId, rule: `min ${MIN_BOOKS_PER_AGENT}`, details: `${ingestion.manifest.filter((work) => work.ok).length} œuvre(s) assignée(s) — plancher ${policy.rule === 'floor-short' ? 'non atteint' : 'atteint'}` });
      }

      return reply.code(201).send({
        agent: agentLite(agent),
        ingestion: { works: ingestion.manifest, assigned: ingestion.manifest.filter((work) => work.ok).length, chars: ingestion.total, avatar_url: avatarUrl },
        policy: { ...policy, max: MAX_BOOKS_PER_AGENT, min: MIN_BOOKS_PER_AGENT },
        proposal: policy.manualRequired ? {
          manual_required: true, missing: policy.missing,
          message: `Seulement ${ingestion.manifest.filter((work) => work.ok).length} œuvre(s) disponible(s) pour ${author.name} — ajoutez des livres manuellement : l'IA les attribuera selon les caractéristiques de l'agent.`,
        } : null,
      });
    } catch (error) {
      return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: error.message });
    }
  });

  // Création d'un agent auteur à partir d'œuvres choisies en ligne (téléchargement temps réel)
  app.post('/v1/literary/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = worksAgentSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'demande invalide', issues: parsed.error.issues });

    const { display_name, works } = parsed.data;
    let ingestion = await ingestSelectedWorks(works);
    if (!ingestion.texts.length) {
      return reply.code(422).send({ error: 'aucune œuvre n’a pu être convertie en texte (formats txt, html ou epub requis)', works: ingestion.manifest });
    }
    // Complétion : au moins 5 œuvres intégrées quand l’agent porte le nom d’un auteur du domaine public.
    let completedFromSources = 0;
    const okCount = () => ingestion.manifest.filter((work) => work.ok).length;
    if (okCount() < AUTHOR_TARGET_BOOKS) {
      const catalogAuthor = findAuthorByName(display_name);
      if (catalogAuthor) {
        try {
          const live = await searchAllSources(catalogAuthor.name, { limitPerSource: 12 });
          const additions = [];
          const surname = (catalogAuthor.name.split(/[ ,]+/).filter((word) => word.length > 3).pop() || catalogAuthor.name).toLowerCase();
          for (const group of live.sources) {
            for (const result of group.results || []) {
              if (!result.ingestable || additions.length >= AUTHOR_TARGET_BOOKS - okCount()) continue;
              if (ingestion.manifest.some((work) => normTitleLite(work.title) === normTitleLite(result.title))) continue;
              if (!`${result.title} ${result.author}`.toLowerCase().includes(surname)) continue;
              additions.push({ title: result.title, url: result.url, author: result.author || catalogAuthor.name, source: group.source });
            }
          }
          if (additions.length) {
            const more = await ingestSelectedWorks(additions);
            ingestion = { manifest: [...ingestion.manifest, ...more.manifest], texts: [...ingestion.texts, ...more.texts], loaded: [...ingestion.loaded, ...more.loaded], total: ingestion.total + more.total };
            completedFromSources = more.manifest.filter((work) => work.ok).length;
          }
        } catch { /* la complétion reste au mieux */ }
      }
    }
    const stats = literaryFingerprint(ingestion.texts);
    const voiceSample = extractVoiceSample(ingestion.texts[0]);
    const persona = buildPersona(
      { name: display_name, era: `corpus de ${ingestion.loaded.length} œuvre(s) chargée(s) en ligne`, kind: 'agent auteur' },
      ingestion.loaded.map((work) => ({ ...work, sample: voiceSample })),
      stats,
    );
    const avatarUrl = await fetchAvatarForName(display_name);

    const baseId = `auteur_c_${slugify(display_name)}`;
    let agentId = baseId;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const taken = app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId }).some((agent) => agent.agent_id === agentId);
      if (!taken) break;
      agentId = `${baseId}_${Math.random().toString(16).slice(2, 6)}`;
    }

    const definition = {
      agent_id: agentId,
      display_name,
      role_name: `${display_name} — agent auteur`.slice(0, 160),
      department: 'Bibliothèque du domaine public',
      seniority: 'executive',
      primary_focus: persona,
      mission: `Incarner ${display_name} et instruire la question posée strictement depuis les œuvres du domaine public chargées en ligne.`,
      instructions: 'Réponds dans la langue de la question. Cite l’œuvre d’où vient ton raisonnement quand c’est possible. Marque explicitement toute hypothèse qui sort des œuvres chargées.',
      constraints: [
        'Ta connaissance se limite strictement aux œuvres du domaine public chargées pour toi.',
        'N’invente ni citation ni fait biographique hors des œuvres chargées.',
      ],
      connectors: ['console'],
      enabled: true,
      veto_power: false,
      metadata: {
        literary: {
          name: display_name, kind: 'agent auteur', lang: 'fr',
          avatar_url: avatarUrl, works: ingestion.manifest, works_count: ingestion.manifest.filter((work) => work.ok).length,
          terms: stats.terms.slice(0, 20).map((term) => term.split(' ')[0]), stats: { words: stats.words, distinct: stats.distinct },
          corpus_file: await saveCorpus(agentId, ingestion.texts),
          generated_at: new Date().toISOString(),
        },
      },
      rule_configuration: {
        user_added_rules: [
          { rule_id: 'AUTEUR_GROUNDING', rule_text: 'Toute affirmation hors des œuvres chargées doit être marquée comme hypothèse explicite.' },
          { rule_id: 'AUTEUR_CITATION', rule_text: 'Quand c’est possible, indique l’œuvre d’où vient ton raisonnement.' },
        ],
      },
    };

    try {
      const agent = app.kayrosContext.engine.swarm.createAgent(definition, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.();
      await appendLedgerEntry(LEDGER_FILE, { type: 'created', tenant: me.tenantId, agent_id: agentId, rule: 'œuvres choisies', details: `${display_name} — ${ingestion.manifest.filter((work) => work.ok).length} œuvre(s)` });
      for (const work of ingestion.manifest.filter((entry) => entry.ok)) {
        await appendLedgerEntry(LEDGER_FILE, { type: 'assigned', tenant: me.tenantId, agent_id: agentId, book: work.title, url: work.url, rule: `source: ${work.source || 'recherche en ligne'}`, details: `${work.chars} signes` });
      }
      return reply.code(201).send({
        agent: agentLite(agent),
        ingestion: { works: ingestion.manifest, assigned: ingestion.manifest.filter((work) => work.ok).length, chars: ingestion.total, avatar_url: avatarUrl, completed_from_sources: completedFromSources },
      });
    } catch (error) {
      return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: error.message });
    }
  });

  // Ajout manuel d'œuvres : ingestion + attribution IA selon les caractéristiques de l'agent + registre.
  app.post('/v1/literary/agents/:agentId/books', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = addBooksSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'demande invalide', issues: parsed.error.issues });

    const agent = app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId }).find((entry) => entry.agent_id === req.params.agentId);
    if (!agent) return reply.code(404).send({ error: 'agent introuvable' });
    const lit = agent.metadata?.literary;
    if (!lit) return reply.code(400).send({ error: 'cet agent n’est pas un agent auteur (aucune personnalité littéraire attachée)' });

    const existingWorks = (agent.metadata.literary.works || []).filter((work) => work.ok);
    const maxBooks = Number(process.env.KAYROS_AUTHOR_MAX_BOOKS || 15);
    const roomLeft = Math.max(0, maxBooks - existingWorks.length);
    const wanted = parsed.data.works;
    if (!roomLeft) return reply.code(409).send({ error: `plafond déjà atteint : ${maxBooks} œuvres pour cet agent` });
    const accepted = wanted.slice(0, roomLeft);
    const rejectedByCap = wanted.slice(roomLeft);

    const ingestion = await ingestSelectedWorks(accepted);
    if (!ingestion.texts.length) {
      return reply.code(422).send({ error: 'aucune œuvre n’a pu être convertie en texte (txt, html ou epub requis)', works: ingestion.manifest });
    }

    // Attribution IA : score de chaque œuvre vs les caractéristiques de l'agent (nom, époque, empreinte).
    const attributions = [];
    for (let index = 0; index < ingestion.manifest.length; index += 1) {
      const entry = ingestion.manifest[index];
      if (!entry.ok) continue;
      const workLite = { title: entry.title, author: entry.author, terms: entry.terms, era: lit.era };
      const { score, reasons } = scoreWorkAgainstAgent(workLite, agent);
      const justification = `Attribué à ${agent.display_name || agent.agent_id} — ${reasons.join(' ; ')}`;
      attributions.push({ work: entry.title, url: entry.url, agent_id: agent.agent_id, score: Number(score.toFixed(2)), justification });
      await appendLedgerEntry(LEDGER_FILE, { type: 'manual_add', tenant: me.tenantId, agent_id: agent.agent_id, book: entry.title, url: entry.url, rule: 'ajout manuel utilisateur', details: `${entry.chars} signes (${entry.kind})` });
      await appendLedgerEntry(LEDGER_FILE, { type: 'attribution', tenant: me.tenantId, agent_id: agent.agent_id, book: entry.title, url: entry.url, rule: `score IA ${Number(score.toFixed(2))}`, details: justification });
    }

    // Reconstruit la mémoire de l'agent : corpus + persona + registre d'œuvres.
    const oldTexts = await loadCorpus(agent.agent_id);
    const allTexts = [...oldTexts, ...ingestion.texts];
    const globalStats = literaryFingerprint(allTexts);
    const newWorks = (agent.metadata.literary.works || []).concat(ingestion.manifest);
    const worksCount = newWorks.filter((work) => work.ok).length;
    const samples = newWorks.filter((work) => work.ok && work.sample);
    const authorLike = { name: lit.name, era: lit.era, kind: lit.kind };
    const persona = buildPersona(authorLike, samples.map((work) => ({ title: work.title, chars: work.chars || 0, sample: work.sample })), globalStats);
    const corpusFile = await saveCorpus(agent.agent_id, allTexts);

    const updated = app.kayrosContext.engine.swarm.updateAgent(agent.agent_id, {
      metadata: { ...agent.metadata, literary: { ...lit, works: newWorks, works_count: worksCount, terms: globalStats.terms.slice(0, 20).map((term) => term.split(' ')[0]), stats: { words: globalStats.words, distinct: globalStats.distinct }, corpus_file: corpusFile } },
      primary_focus: persona,
    }, { tenantId: me.tenantId, by: me.email });
    await app.kayrosContext.engine.swarm.flush?.();

    return {
      agent: agentLite(updated),
      results: attributions,
      rejected_by_cap: rejectedByCap.map((work) => work.title),
      works_count: worksCount,
      max_books: maxBooks,
    };
  });

  // Registre d'ingestion / d'attribution (traçabilité).
  app.get('/v1/literary/ledger', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));
    const entries = await readLedgerEntries(LEDGER_FILE, limit);
    return { entries, count: entries.length };
  });
}
