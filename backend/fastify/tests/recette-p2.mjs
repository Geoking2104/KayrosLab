// KayrosLab — RECETTE P2 : parcours HTTP complet contre un serveur en marche.
//
// Leve la reserve du CDC §8.2 : jusqu'ici les statuts « realise » attestaient
// d'un code teste UNITAIREMENT. Ce script demarre une vraie base PostgreSQL,
// applique la migration, monte un vrai serveur Fastify et parle HTTP.
//
//   node backend/fastify/tests/recette-p2.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';

import { pgliteAsPool } from '../lib/pglite-pool.mjs';
import { PostgresCanvasRepository, PostgresEventLog, PostgresAgentRegistry } from '../lib/canvas-postgres.mjs';
import { createEngine } from '../../../core/index.mjs';
import { createCanvasStudio, createAgentIdentity, Recorder, replay, diffEtats } from '../../../core/canvas/index.mjs';
import canvasRoutes from '../routes/canvas.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

// --- petit harnais de test, sans dependance -------------------------------
let ok = 0; const echecs = [];
const etape = (nom) => process.stdout.write(`\n\x1b[1m${nom}\x1b[0m\n`);
function verifie(libelle, condition, detail = '') {
  if (condition) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${libelle}`); }
  else { echecs.push(libelle); console.log(`  \x1b[31mKO\x1b[0m  ${libelle}${detail ? ` — ${detail}` : ''}`); }
}

// ==========================================================================
etape('1. Base PostgreSQL et migration');

const db = new PGlite();
const version = (await db.query('select version()')).rows[0].version;
console.log(`  moteur : ${version.split(',')[0]}`);
const pool = pgliteAsPool(db);

const sql = await readFile(join(ici, '../migrations/001_canvas.sql'), 'utf8');
await db.exec(sql);
const tables = (await db.query(
  `select table_name from information_schema.tables where table_schema='public' order by 1`,
)).rows.map((r) => r.table_name);
verifie('migration appliquee (3 tables)', ['canvas_workspace', 'canvas_event', 'canvas_agent'].every((t) => tables.includes(t)), tables.join(','));

// Le trigger append-only et le CHECK sont-ils REELLEMENT actifs ?
await db.query(
  `INSERT INTO canvas_workspace (id, tenant_id, nom, data, created_at, updated_at)
   VALUES ('probe','t1','Probe','{}'::jsonb, now(), now())`,
);
await db.query(
  `INSERT INTO canvas_event (seq, workspace_id, tenant_id, type, payload, ts, prev_hash, hash)
   VALUES (0,'probe','t1','node.add','{}'::jsonb, now(),'genesis','h0')`,
);
let appendOnly = false;
try { await db.query(`UPDATE canvas_event SET type='falsifie' WHERE hash='h0'`); }
catch { appendOnly = true; }
verifie('journal append-only applique par la base (UPDATE refuse)', appendOnly);

let deleteRefuse = false;
try { await db.query(`DELETE FROM canvas_event WHERE hash='h0'`); }
catch { deleteRefuse = true; }
verifie('journal append-only applique par la base (DELETE refuse)', deleteRefuse);

let checkGate = false;
try {
  await db.query(
    `INSERT INTO canvas_agent (id, tenant_id, persona, public_key, can_resolve_gate)
     VALUES ('mechant','t1','X','k', true)`,
  );
} catch { checkGate = true; }
verifie('EF-243 grave dans le schema (can_resolve_gate = true refuse)', checkGate);

// DECOUVERT EN RECETTE : le trigger bloquait aussi le ON DELETE CASCADE, ce
// qui rendait indestructible tout canvas ayant un journal. La suppression
// ordinaire doit echouer, la purge deliberee doit passer.
let cascadeBloquee = false;
try { await db.query(`DELETE FROM canvas_workspace WHERE id='probe'`); }
catch { cascadeBloquee = true; }
verifie('une suppression ordinaire n efface pas un canvas journalise', cascadeBloquee);

// ==========================================================================
etape('2. Repository PostgreSQL');

const repo = new PostgresCanvasRepository({ pool });
const journal = new PostgresEventLog({ pool });
const agents = new PostgresAgentRegistry({ pool });

const engine = createEngine({});                      // P0 : mock, hors ligne
const studio = createCanvasStudio(engine, { repository: repo });

// ==========================================================================
etape('3. Serveur Fastify');

const app = Fastify({ logger: false });
// Authentification simulee : la recette porte sur le canvas, pas sur scrypt.
app.decorate('requireAuth', async (req, reply) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) { reply.code(401).send({ error: 'jeton requis' }); return null; }
  const [email, tenantId] = h.slice(7).split('@@');
  if (!email) { reply.code(401).send({ error: 'jeton invalide' }); return null; }
  return { email, tenantId: tenantId || 'default' };
});
const idees = new Map();
app.decorate('kayrosContext', {
  canvas: studio, engine, canvasJournal: journal,
  ideas: { save: async (i) => idees.set(i.id, i) },
});
await app.register(canvasRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;
console.log(`  serveur en ecoute sur ${base}`);

const JETON = 'geoffroy@kayroslab.com@@t1';
const AUTRE = 'intrus@ailleurs.com@@t2';

async function http(methode, chemin, { body, jeton = JETON } = {}) {
  const res = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { 'content-type': 'application/json', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const brut = await res.text();
  let json = null;
  try { json = JSON.parse(brut); } catch { json = brut; }
  return { statut: res.status, corps: json };
}

// ==========================================================================
etape('4. Authentification et isolation multi-tenant');

verifie('401 sans jeton', (await http('GET', '/v1/canvas', { jeton: null })).statut === 401);

const cree = await http('POST', '/v1/canvas', { body: { id: 'ws-recette', nom: 'Session strategique' } });
verifie('201 a la creation du canvas', cree.statut === 201, `recu ${cree.statut}`);
verifie('le tenant vient du jeton, pas du corps', cree.corps.workspace?.tenantId === 't1');

const intrusion = await http('GET', '/v1/canvas/ws-recette', { jeton: AUTRE });
verifie('404 (et non 403) pour un autre tenant', intrusion.statut === 404, `recu ${intrusion.statut}`);
verifie('le canvas n apparait pas dans la liste d un autre tenant',
  (await http('GET', '/v1/canvas', { jeton: AUTRE })).corps.workspaces.length === 0);

// ==========================================================================
etape('5. Noeuds, aretes et persistance reelle');

const titres = [
  'Offre solaire en autoconsommation pour PME',
  'Solaire partage entre PME voisines',
  'Mobilite douce pour les trajets domicile-travail',
  'Flotte de velos partages en zone rurale',
];
const ids = [];
for (const titre of titres) {
  const r = await http('POST', '/v1/canvas/ws-recette/nodes', { body: { titre } });
  if (r.statut === 201) ids.push(r.corps.workspace.nodes.at(-1).id);
}
verifie('4 noeuds crees via HTTP', ids.length === 4);

const critique = await http('POST', '/v1/canvas/ws-recette/nodes', { body: { titre: 'Le marche est sature', type: 'critique' } });
const idCritique = critique.corps.workspace.nodes.at(-1).id;
const arete = await http('POST', '/v1/canvas/ws-recette/edges', { body: { from: idCritique, to: ids[0], relation: 'contredit' } });
verifie('201 a la creation d une arete typee', arete.statut === 201);

const doublon = await http('POST', '/v1/canvas/ws-recette/edges', { body: { from: idCritique, to: ids[0], relation: 'contredit' } });
verifie('409 sur arete en doublon', doublon.statut === 409, `recu ${doublon.statut}`);
const invalide = await http('POST', '/v1/canvas/ws-recette/edges', { body: { from: idCritique, to: ids[0], relation: 'ressemble' } });
verifie('400 sur relation hors ontologie', invalide.statut === 400, `recu ${invalide.statut}`);
verifie('400 sur noeud sans titre', (await http('POST', '/v1/canvas/ws-recette/nodes', { body: { corps: 'sans titre' } })).statut === 400);

// La persistance est-elle REELLE ? On relit depuis la base, pas depuis le cache.
const enBase = await db.query(`SELECT data, version FROM canvas_workspace WHERE id='ws-recette'`);
verifie('le canvas est bien en base', enBase.rows.length === 1);
verifie('les 5 noeuds sont persistes en JSONB', enBase.rows[0].data.nodes.length === 5, `${enBase.rows[0].data.nodes?.length} noeuds`);
verifie('le verrou optimiste s incremente', Number(enBase.rows[0].version) > 1, `version ${enBase.rows[0].version}`);

// ==========================================================================
etape('6. Ingestion, quota et sourcage');

const quota0 = await http('GET', '/v1/canvas/ws-recette/quota?taille=100');
verifie('le quota est consultable avant depot', quota0.statut === 200 && quota0.corps.depasserait === false);

const ing = await http('POST', '/v1/canvas/ws-recette/sources', {
  body: { nom: 'etude-marche.md', mime: 'text/markdown', contenu: 'Le solaire en autoconsommation progresse de 30 pourcent par an chez les PME industrielles.' },
});
verifie('201 a l ingestion d un document', ing.statut === 201, `recu ${ing.statut}`);
const docId = ing.corps.doc?.id;

const sensible = await http('POST', '/v1/canvas/ws-recette/sources', {
  body: { nom: 'conformite.md', contenu: 'Note de conformite RGPD sur le traitement des donnees personnelles.' },
});
verifie('422 motive sur document sensible en palier non souverain', sensible.statut === 422, `recu ${sensible.statut}`);
verifie('le motif du refus est explicite', /sensible/.test(sensible.corps?.motif ?? ''), sensible.corps?.motif);

const rech = await http('GET', '/v1/canvas/ws-recette/search?q=solaire&k=3');
verifie('la recherche semantique repond', rech.statut === 200 && Array.isArray(rech.corps.resultats));

// ==========================================================================
etape('7. Structuration');

const rc = await http('POST', '/v1/canvas/ws-recette/recluster', { body: {} });
verifie('200 au reclustering', rc.statut === 200, `recu ${rc.statut}`);
verifie('des clusters sont formes', (rc.corps.clusters?.length ?? 0) > 0, `${rc.corps.clusters?.length} clusters`);
verifie('chaque noeud est rattache a un cluster', rc.corps.workspace.nodes.every((n) => n.clusterId));

const dup = await http('GET', '/v1/canvas/ws-recette/duplicates');
verifie('les doublons sont suggeres, jamais appliques', dup.statut === 200 && Array.isArray(dup.corps.suggestions));

// ==========================================================================
etape('8. Sparring et frameworks');

const sw = await http('POST', `/v1/canvas/ws-recette/nodes/${ids[0]}/swarm`, { body: { personaIds: ['vc-sceptique', 'client-cible'] } });
verifie('200 au lancement du swarm', sw.statut === 200, `recu ${sw.statut}`);
verifie('2 noeuds d agents crees', sw.corps.crees?.length === 2, `${sw.corps.crees?.length}`);
verifie('le cout est rendu', typeof sw.corps.cout?.appels === 'number');

const sc = await http('POST', `/v1/canvas/ws-recette/nodes/${ids[0]}/framework`, { body: { nom: 'scamper' } });
// Assertion SEMANTIQUE : ce qui compte est que les 7 axes soient couverts, pas
// le nombre de noeuds — celui-ci depend de la verbosite du modele.
const axes = new Set(sc.corps.workspace.nodes.filter((n) => n.meta?.framework === 'SCAMPER').map((n) => n.meta.transformation));
verifie('SCAMPER couvre les 7 axes', sc.statut === 200 && axes.size === 7, `${axes.size} axes`);
verifie('les sorties sont bornees (3 max par axe)',
  sc.corps.crees.length <= 21, `${sc.corps.crees.length} noeuds`);

const pm = await http('POST', `/v1/canvas/ws-recette/nodes/${ids[0]}/framework`, { body: { nom: 'pre-mortem', horizon: '2030' } });
verifie('le pre-mortem repond', pm.statut === 200, `recu ${pm.statut}`);
verifie('la couverture des causes est declaree', pm.corps.couverture !== undefined);
verifie('400 sur framework inconnu', (await http('POST', `/v1/canvas/ws-recette/nodes/${ids[0]}/framework`, { body: { nom: 'inexistant' } })).statut === 400);

// ==========================================================================
etape('9. Convergence vers le portefeuille');

const mat = await http('POST', '/v1/canvas/ws-recette/matrix', { body: { notes: { [ids[0]]: { impact: 9, effort: 3, confiance: 7 } } } });
verifie('la matrice distingue evalue et non evalue', mat.statut === 200 && mat.corps.evaluees === 1 && mat.corps.nonEvaluees > 0);
verifie('le quadrant est calcule', mat.corps.cellules.find((c) => c.nodeId === ids[0])?.quadrant === 'quick-win');
verifie('aucun quadrant invente pour un noeud non note',
  mat.corps.cellules.filter((c) => !c.evalue).every((c) => c.quadrant === null));

const prom = await http('POST', '/v1/canvas/ws-recette/promote', { body: { nodeId: ids[0], ideaId: 'D-recette-1' } });
verifie('201 a la promotion en idee', prom.statut === 201, `recu ${prom.statut}`);
verifie('l idee entre au stade Recueillir', prom.corps.idea?.stage === 'recueillir');
verifie('les hypotheses sont derivees', (prom.corps.traitement?.hypotheses?.length ?? 0) > 0);
verifie('les angles morts sont assignes a un agent',
  prom.corps.traitement.cibles.filter((c) => c.origine === 'angle_mort').every((c) => c.agent));
verifie('l idee rejoint le portefeuille', idees.has('D-recette-1'));

const orig = await http('GET', '/v1/canvas/ws-recette/origin/D-recette-1');
verifie('le lien retour idee -> canvas fonctionne', orig.statut === 200 && orig.corps.workspaceId === 'ws-recette');
verifie('404 pour une idee etrangere au canvas', (await http('GET', '/v1/canvas/ws-recette/origin/inconnue')).statut === 404);

// La recherche par idee promue passe-t-elle par l'index GIN ?
const parIdee = await http('GET', '/v1/canvas?ideaId=D-recette-1');
verifie('recherche par idee promue (index GIN jsonb)', parIdee.corps.workspaces?.length === 1);

// Et le plein texte francais ?
const parTexte = await http('GET', '/v1/canvas?q=solaire');
verifie('recherche plein texte francais (to_tsvector)', parTexte.corps.workspaces?.length === 1, JSON.stringify(parTexte.corps).slice(0, 80));

// ==========================================================================
etape('10. Retrait de source et invalidation');

const retrait = await http('DELETE', `/v1/canvas/ws-recette/sources/${docId}`);
verifie('200 au retrait de la source', retrait.statut === 200, `recu ${retrait.statut}`);
verifie('les fragments sont retires de l index', retrait.corps.chunksRetires > 0);
verifie('404 sur retrait d une source inconnue', (await http('DELETE', '/v1/canvas/ws-recette/sources/inconnu')).statut === 404);

// ==========================================================================
etape('11. Journal chaine persiste');

const recorder = new Recorder();
let wsJ = (await recorder.record(null, { type: 'workspace.create', payload: { id: 'ws-journal', nom: 'Journal', tenantId: 't1' } })).workspace;
await repo.save(wsJ);
for (const e of recorder.log.events()) await journal.append(e, { tenantId: 't1' });

for (const titre of ['Premiere idee', 'Seconde idee']) {
  const r = await recorder.record(wsJ, { type: 'node.add', payload: { titre }, actorId: 'geoffroy' });
  wsJ = r.workspace;
  await journal.append(r.evenement, { tenantId: 't1' });
}
await repo.save(wsJ);

const v = await journal.verify('ws-journal');
verifie('la chaine persistee est integre', v.ok === true, v.motif ?? '');

const relu = await journal.load('ws-journal');
verifie('le journal se relit depuis la base', relu.longueur === 3, `${relu.longueur} evenements`);
const rejoue = replay(relu, 'ws-journal');
verifie('le rejeu depuis la base reproduit l etat', diffEtats(wsJ, rejoue.workspace).identiques === true);

const exp = await http('GET', '/v1/canvas/ws-journal/journal/export');
verifie('l export JSONL est servi', typeof exp.corps === 'string' && exp.corps.split('\n').length === 3);
const verifHttp = await http('GET', '/v1/canvas/ws-journal/journal/verify');
verifie('la verification est exposee en HTTP', verifHttp.statut === 200 && verifHttp.corps.ok === true);

// Deux evenements de meme hash doivent etre refuses.
let hashUnique = false;
try {
  await journal.append({ ...relu.events()[0], seq: 99 }, { tenantId: 't1' });
} catch { hashUnique = true; }
verifie('un hash duplique est refuse par la base', hashUnique);

// ==========================================================================
etape('12. Identite agent persistee');

const { identite } = await createAgentIdentity({ id: 'critic-1', persona: 'Critic', tenantId: 't1' });
await agents.register(identite);
const relu2 = await agents.get('critic-1');
verifie('l agent est persiste avec sa cle publique', relu2?.publicKey === identite.publicKey);
verifie('canResolveGate reste faux apres aller-retour base', relu2.canResolveGate === false);

await agents.join('critic-1', 'ws-recette');
verifie('l appartenance est persistee', (await agents.get('critic-1')).memberships.includes('ws-recette'));
await agents.join('critic-1', 'ws-recette');
verifie('l adhesion reste idempotente en base', (await agents.get('critic-1')).memberships.length === 1);
verifie('membersOf retrouve l agent', (await agents.membersOf('ws-recette')).length === 1);
await agents.leave('critic-1', 'ws-recette');
verifie('le retrait d appartenance fonctionne', (await agents.get('critic-1')).memberships.length === 0);

// ==========================================================================
etape('13. Purge deliberee');

verifie('la purge exige un motif',
  await (async () => { try { await repo.purge('probe', {}); return false; } catch (e) { return /motif requis/.test(e.message); } })());

const purge = await repo.purge('probe', { motif: 'donnee de sonde', par: 'recette' });
verifie('la purge deliberee supprime canvas et journal', purge.supprime === true && purge.evenements === 1);
verifie('le canvas a disparu', (await repo.get('probe')) === null);
verifie('l effacement laisse lui-meme une trace',
  (await db.query('SELECT motif FROM canvas_purge_log WHERE workspace_id=$1', ['probe'])).rows[0]?.motif === 'donnee de sonde');
verifie('le drapeau de purge est retombe',
  await (async () => {
    await db.query(`INSERT INTO canvas_workspace (id,tenant_id,nom,data,created_at,updated_at) VALUES ('probe2','t1','P2','{}'::jsonb,now(),now())`);
    await db.query(`INSERT INTO canvas_event (seq,workspace_id,tenant_id,type,payload,ts,prev_hash,hash) VALUES (0,'probe2','t1','node.add','{}'::jsonb,now(),'genesis','hp2')`);
    try { await db.query(`DELETE FROM canvas_workspace WHERE id='probe2'`); return false; } catch { return true; }
  })());

// ==========================================================================
etape('14. Verrou optimiste sous ecriture concurrente');

const { workspace: wsA, version: vA } = await repo.getWithVersion('ws-recette');
const r1 = await repo.saveIfVersion({ ...wsA, nom: 'Renomme par Alice' }, vA);
const r2 = await repo.saveIfVersion({ ...wsA, nom: 'Renomme par Bob' }, vA);
verifie('la premiere ecriture concurrente passe', r1.ok === true);
verifie('la seconde est refusee au lieu d ecraser', r2.ok === false && r2.conflit === true);
verifie('la version a bien avance', (await repo.getWithVersion('ws-recette')).version === vA + 1);

// ==========================================================================
await app.close();
await db.close();

console.log(`\n${'='.repeat(62)}`);
console.log(`RECETTE P2 — ${ok} verifications passees, ${echecs.length} echec(s)`);
if (echecs.length) {
  console.log('\nEchecs :');
  for (const e of echecs) console.log(`  - ${e}`);
}
console.log('='.repeat(62));
process.exit(echecs.length ? 1 : 0);
