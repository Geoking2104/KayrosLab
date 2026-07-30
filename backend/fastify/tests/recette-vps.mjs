#!/usr/bin/env node
// KayrosLab — RECETTE contre le PostgreSQL REEL du VPS.
//
// La recette P2 (`recette-p2.mjs`) tourne contre PGlite : meme moteur, mais
// embarque. Celle-ci s'execute SUR le VPS, contre le serveur de production,
// avec le pilote `pg`, la vraie configuration et la vraie cohabitation openDPE.
//
//   cd /opt/kayroslab/backend/fastify && node tests/recette-vps.mjs
//
// Elle est NON DESTRUCTIVE : tout ce qu'elle cree porte le prefixe `recette-`
// et est purge en fin de parcours. Elle ne touche a aucune donnee existante.

import Fastify from 'fastify';
import { buildCanvasStore } from '../lib/canvas-store.mjs';
import { createCanvasStudio, createAgentIdentity, Recorder, replay, diffEtats } from '../../../core/canvas/index.mjs';
import { InMemoryVectorStore } from '../../../core/memory.mjs';
import { MockProvider, KayrosLLM, RoutingPolicy } from '../../../core/kayros-llm.mjs';
import { MockEmbeddings } from '../../../core/embeddings.mjs';
import canvasRoutes from '../routes/canvas.mjs';

let ok = 0; const echecs = [];
const etape = (n) => process.stdout.write(`\n\x1b[1m${n}\x1b[0m\n`);
const verifie = (l, c, d = '') => {
  if (c) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${l}`); }
  else { echecs.push(l); console.log(`  \x1b[31mKO\x1b[0m  ${l}${d ? ` — ${d}` : ''}`); }
};

const PREFIXE = `recette-${Date.now()}`;
let store;

try {
  // ======================================================================
  etape('1. Connexion au PostgreSQL du VPS');

  // `--embarque` rejoue ce parcours contre PGlite : cela valide le script
  // avant de le lancer sur le serveur. Les controles de cloisonnement
  // (superutilisateur, bases voisines) ne sont alors PAS significatifs et sont
  // annonces comme tels — un embarque tourne toujours en superutilisateur.
  const EMBARQUE = process.argv.includes('--embarque');
  if (EMBARQUE) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { readFile } = await import('node:fs/promises');
    const { pgliteAsPool } = await import('../lib/pglite-pool.mjs');
    const db = new PGlite();
    await db.exec(await readFile(new URL('../migrations/001_canvas.sql', import.meta.url), 'utf8'));
    store = await buildCanvasStore({}, { pool: pgliteAsPool(db) });
    console.log('  \x1b[33mmode embarque\x1b[0m — cloisonnement non significatif');
  } else if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL absent. Executer d abord provision-postgres.sh.\n');
    process.exit(2);
  } else {
    store = await buildCanvasStore(process.env);
  }
  verifie('mode postgres actif', store.mode === 'postgres', store.mode);
  console.log(`  base   : ${store.info?.base}`);
  console.log(`  moteur : ${store.info?.version}`);

  const pool = store.pool;

  // Le pilote `pg` est-il bien celui utilise (et non PGlite) ?
  const drapeau = await pool.query('SELECT current_setting(\'server_version_num\') AS n, inet_server_addr() AS addr');
  verifie('serveur PostgreSQL >= 14', Number(drapeau.rows[0].n) >= 140000, drapeau.rows[0].n);

  // ======================================================================
  etape('2. Cloisonnement vis-a-vis d openDPE');

  const bases = await pool.query(
    `SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1') ORDER BY 1`,
  );
  console.log(`  bases sur l instance : ${bases.rows.map((r) => r.datname).join(', ')}`);

  const significatif = !process.argv.includes('--embarque');
  const verifieCloisonnement = (l, c, d) => (significatif
    ? verifie(l, c, d)
    : console.log(`  \x1b[90m--\x1b[0m  ${l} (non significatif en embarque)`));

  const croise = await pool.query(
    `SELECT count(*)::int AS n FROM pg_database d
      WHERE d.datname <> current_database()
        AND d.datname NOT IN ('template0','template1')
        AND has_database_privilege(current_user, d.datname, 'CONNECT')`,
  );
  verifieCloisonnement('aucun acces vers les bases voisines', croise.rows[0].n === 0,
    `${croise.rows[0].n} base(s) accessibles — REVOKE CONNECT requis`);

  const privileges = await pool.query(
    `SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`,
  );
  const p = privileges.rows[0];
  verifieCloisonnement('le role applicatif n est pas superutilisateur', p.rolsuper === false);
  verifieCloisonnement('le role ne peut pas creer de base', p.rolcreatedb === false);
  verifieCloisonnement('le role ne peut pas creer de role', p.rolcreaterole === false);

  const publicSchema = await pool.query(
    `SELECT has_schema_privilege('public', 'public', 'CREATE') AS c`,
  );
  verifieCloisonnement('PUBLIC ne peut pas ecrire dans le schema', publicSchema.rows[0].c === false);

  // ======================================================================
  etape('3. Schema et contraintes');

  const tables = (await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
  )).rows.map((r) => r.table_name);
  verifie('les 4 tables du canvas existent',
    ['canvas_agent', 'canvas_event', 'canvas_purge_log', 'canvas_workspace'].every((t) => tables.includes(t)),
    tables.join(','));

  const index = (await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'canvas_%'`,
  )).rows.map((r) => r.indexname);
  verifie('index GIN sur les idees promues', index.includes('idx_canvas_promoted'));
  verifie('index de recherche plein texte', index.includes('idx_canvas_recherche'));
  verifie('unicite des empreintes du journal', index.includes('idx_event_hash'));

  // Le trigger append-only est-il ACTIF sur ce serveur ?
  await pool.query(
    `INSERT INTO canvas_workspace (id, tenant_id, nom, data, created_at, updated_at)
     VALUES ($1,'recette','Sonde','{}'::jsonb, now(), now())`, [PREFIXE],
  );
  await pool.query(
    `INSERT INTO canvas_event (seq, workspace_id, tenant_id, type, payload, ts, prev_hash, hash)
     VALUES (0,$1,'recette','node.add','{}'::jsonb, now(),'genesis',$2)`, [PREFIXE, `h-${PREFIXE}`],
  );
  let refuse = false;
  try { await pool.query(`UPDATE canvas_event SET type='falsifie' WHERE hash=$1`, [`h-${PREFIXE}`]); }
  catch { refuse = true; }
  verifie('journal append-only actif sur le serveur', refuse);

  let checkGate = false;
  try {
    await pool.query(
      `INSERT INTO canvas_agent (id, tenant_id, persona, public_key, can_resolve_gate)
       VALUES ($1,'recette','X','k', true)`, [`${PREFIXE}-agent`],
    );
  } catch { checkGate = true; }
  verifie('EF-243 applique par la contrainte CHECK', checkGate);

  // ======================================================================
  etape('4. Parcours HTTP complet');

  const llm = new KayrosLLM({ mock: new MockProvider() }, new RoutingPolicy({ defaultProvider: 'mock', fallback: 'mock' }));
  const engine = { llm, embeddings: new MockEmbeddings(), vectors: new InMemoryVectorStore(), agents: {} };
  const studio = createCanvasStudio(engine, { repository: store.repo });

  const app = Fastify({ logger: false });
  app.decorate('requireAuth', async (req, reply) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) { reply.code(401).send({ error: 'jeton requis' }); return null; }
    const [email, tenantId] = h.slice(7).split('@@');
    return { email, tenantId: tenantId || 'recette' };
  });
  const idees = new Map();
  app.decorate('kayrosContext', { canvas: studio, engine, canvasJournal: store.journal, ideas: { save: async (i) => idees.set(i.id, i) } });
  await app.register(canvasRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const http = async (m, c, { body, jeton = 'recette@kayroslab.com@@recette' } = {}) => {
    const r = await fetch(`${base}${c}`, {
      method: m,
      headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    try { return { statut: r.status, corps: JSON.parse(t) }; } catch { return { statut: r.status, corps: t }; }
  };

  const wsId = `${PREFIXE}-ws`;
  verifie('201 a la creation', (await http('POST', '/v1/canvas', { body: { id: wsId, nom: 'Recette VPS' } })).statut === 201);

  const ids = [];
  for (const titre of ['Offre solaire pour PME', 'Solaire partage entre voisins', 'Mobilite douce en zone rurale']) {
    const r = await http('POST', `/v1/canvas/${wsId}/nodes`, { body: { titre } });
    if (r.statut === 201) ids.push(r.corps.workspace.nodes.at(-1).id);
  }
  verifie('3 noeuds crees et persistes en base', ids.length === 3);

  const enBase = await pool.query('SELECT data, version FROM canvas_workspace WHERE id = $1', [wsId]);
  verifie('relecture directe en base coherente', enBase.rows[0]?.data.nodes.length === 3);
  verifie('verrou optimiste incremente', Number(enBase.rows[0].version) > 1);

  verifie('reclustering', (await http('POST', `/v1/canvas/${wsId}/recluster`, { body: {} })).statut === 200);
  const prom = await http('POST', `/v1/canvas/${wsId}/promote`, { body: { nodeId: ids[0], ideaId: `${PREFIXE}-idee` } });
  verifie('promotion vers le portefeuille', prom.statut === 201 && prom.corps.idea?.stage === 'recueillir');

  const parIdee = await http('GET', `/v1/canvas?ideaId=${PREFIXE}-idee`);
  verifie('index GIN interroge via HTTP', parIdee.corps.workspaces?.length === 1);
  const parTexte = await http('GET', '/v1/canvas?q=solaire');
  verifie('recherche plein texte francaise sur le serveur', (parTexte.corps.workspaces?.length ?? 0) >= 1);

  // ======================================================================
  etape('5. Journal persiste sur le serveur');

  const rec = new Recorder();
  const jwsId = `${PREFIXE}-journal`;
  let wsJ = (await rec.record(null, { type: 'workspace.create', payload: { id: jwsId, nom: 'Journal', tenantId: 'recette' } })).workspace;
  await store.repo.save(wsJ);
  for (const e of rec.log.events()) await store.journal.append(e, { tenantId: 'recette' });
  for (const titre of ['Idee A', 'Idee B']) {
    const r = await rec.record(wsJ, { type: 'node.add', payload: { titre }, actorId: 'recette' });
    wsJ = r.workspace;
    await store.journal.append(r.evenement, { tenantId: 'recette' });
  }
  await store.repo.save(wsJ);

  const v = await store.journal.verify(jwsId);
  verifie('chaine integre sur le serveur', v.ok === true, v.motif ?? '');
  const rejoue = replay(await store.journal.load(jwsId), jwsId);
  verifie('rejeu depuis le serveur identique', diffEtats(wsJ, rejoue.workspace).identiques === true);

  // ======================================================================
  etape('6. Identite agent persistee');

  if (store.agents) {
    const { identite } = await createAgentIdentity({ id: `${PREFIXE}-critic`, persona: 'Critic', tenantId: 'recette' });
    await store.agents.register(identite);
    const relu = await store.agents.get(`${PREFIXE}-critic`);
    verifie('cle publique persistee', relu?.publicKey === identite.publicKey);
    verifie('canResolveGate faux apres aller-retour', relu.canResolveGate === false);
    await store.agents.join(`${PREFIXE}-critic`, wsId);
    verifie('appartenance persistee', (await store.agents.get(`${PREFIXE}-critic`)).memberships.includes(wsId));
  }

  // ======================================================================
  etape('7. Nettoyage (non destructif)');

  await app.close();
  for (const id of [wsId, jwsId, PREFIXE]) {
    try { await store.repo.purge(id, { motif: 'donnees de recette', par: 'recette-vps' }); } catch { /* deja absent */ }
  }
  await pool.query('DELETE FROM canvas_agent WHERE tenant_id = $1', ['recette']);
  await pool.query('DELETE FROM canvas_purge_log WHERE motif = $1', ['donnees de recette']);
  const restes = await pool.query("SELECT count(*)::int AS n FROM canvas_workspace WHERE tenant_id='recette'");
  verifie('aucune donnee de recette laissee en base', restes.rows[0].n === 0, `${restes.rows[0].n} reste(s)`);

} catch (e) {
  console.error(`\n\x1b[31mInterruption : ${e.message}\x1b[0m`);
  echecs.push(`exception : ${e.message}`);
} finally {
  await store?.pool?.end?.();
}

console.log(`\n${'='.repeat(62)}`);
console.log(`RECETTE VPS — ${ok} verifications passees, ${echecs.length} echec(s)`);
if (echecs.length) { console.log('\nEchecs :'); for (const e of echecs) console.log(`  - ${e}`); }
console.log('='.repeat(62));
process.exit(echecs.length ? 1 : 0);
