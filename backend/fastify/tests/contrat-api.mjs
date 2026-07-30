#!/usr/bin/env node
// KayrosLab — Contrat frontend <-> backend.
//
// Verifie que chaque reponse contient les champs que `frontend/canvas-app/src/api.js`
// consomme. C'est le defaut classique d'une integration : le backend renvoie
// `{data}` la ou le front lit `.workspace`, et rien ne le signale avant le
// premier clic en production.

import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { pgliteAsPool } from '../lib/pglite-pool.mjs';
import { PostgresCanvasRepository, PostgresEventLog } from '../lib/canvas-postgres.mjs';
import { createEngine } from '../../../core/index.mjs';
import { createCanvasStudio } from '../../../core/canvas/index.mjs';
import canvasRoutes from '../routes/canvas.mjs';

let ok = 0; const echecs = [];
const v = (l, c, d = '') => { if (c) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${l}`); } else { echecs.push(l); console.log(`  \x1b[31mKO\x1b[0m  ${l}${d ? ` — ${d}` : ''}`); } };

const db = new PGlite();
await db.exec(await readFile(new URL('../migrations/001_canvas.sql', import.meta.url), 'utf8'));
const pool = pgliteAsPool(db);
const engine = createEngine({});
const studio = createCanvasStudio(engine, { repository: new PostgresCanvasRepository({ pool }) });

const app = Fastify({ logger: false });
app.decorate('requireAuth', async (req, reply) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) { reply.code(401).send({ error: 'jeton requis' }); return null; }
  return { email: 'contrat@test', tenantId: 'contrat' };
});
app.decorate('kayrosContext', { canvas: studio, engine, canvasJournal: new PostgresEventLog({ pool }), ideas: { save: async () => {} } });
await app.register(canvasRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;

const call = async (m, c, b) => {
  const r = await fetch(`${base}${c}`, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  try { return { statut: r.status, corps: JSON.parse(t) }; } catch { return { statut: r.status, corps: t }; }
};

console.log('\n\x1b[1mContrat frontend ↔ backend\x1b[0m');

const cree = await call('POST', '/v1/canvas', { id: 'c1', nom: 'Contrat' });
v('creerCanvas -> .workspace.id', cree.corps?.workspace?.id === 'c1');

const lu = await call('GET', '/v1/canvas/c1');
v('lireCanvas -> .workspace + .stats', Boolean(lu.corps?.workspace?.id && lu.corps?.stats));

const liste = await call('GET', '/v1/canvas?q=Contrat');
v('listerCanvas -> .workspaces[]', Array.isArray(liste.corps?.workspaces));

const noeud = await call('POST', '/v1/canvas/c1/nodes', { titre: 'Idee solaire' });
v('ajouterNoeud -> .workspace.nodes[]', Array.isArray(noeud.corps?.workspace?.nodes));
const nodeId = noeud.corps.workspace.nodes.at(-1).id;

const maj = await call('PATCH', `/v1/canvas/c1/nodes/${nodeId}`, { titre: 'Idee revisee' });
v('majNoeud -> .workspace', Boolean(maj.corps?.workspace));

const n2 = await call('POST', '/v1/canvas/c1/nodes', { titre: 'Seconde idee' });
const arete = await call('POST', '/v1/canvas/c1/edges', { from: nodeId, to: n2.corps.workspace.nodes.at(-1).id, relation: 'soutient' });
v('ajouterArete -> .workspace.edges[]', Array.isArray(arete.corps?.workspace?.edges));

const rc = await call('POST', '/v1/canvas/c1/recluster', {});
v('reclusteriser -> .workspace + .clusters + .nonIndexes', Boolean(rc.corps?.workspace && rc.corps?.clusters && Array.isArray(rc.corps?.nonIndexes)));

const dup = await call('GET', '/v1/canvas/c1/duplicates');
v('doublons -> .suggestions[]', Array.isArray(dup.corps?.suggestions));

const rech = await call('GET', '/v1/canvas/c1/search?q=solaire&k=5');
v('chercher -> .resultats[]', Array.isArray(rech.corps?.resultats));

const quota = await call('GET', '/v1/canvas/c1/quota?taille=10');
v('quota -> .depasserait + .restant', typeof quota.corps?.depasserait === 'boolean' && typeof quota.corps?.restant === 'number');

const ing = await call('POST', '/v1/canvas/c1/sources', { nom: 'n.md', contenu: 'Contenu solaire pour la recette.' });
v('ingerer -> .ok + .doc.chunks[]', ing.corps?.ok === true && Array.isArray(ing.corps?.doc?.chunks));

const refus = await call('POST', '/v1/canvas/c1/sources', { nom: 'c.md', contenu: 'Note de conformite RGPD.' });
v('ingerer refuse -> 422 + .motif', refus.statut === 422 && typeof refus.corps?.motif === 'string');

const sup = await call('DELETE', `/v1/canvas/c1/sources/${ing.corps.doc.id}`);
v('retirerSource -> .workspace + .chunksRetires', Boolean(sup.corps?.workspace) && typeof sup.corps?.chunksRetires === 'number');

const sw = await call('POST', `/v1/canvas/c1/nodes/${nodeId}/swarm`, { personaIds: ['vc-sceptique'] });
v('swarm -> .workspace/.crees/.desaccords/.appuis/.echecs/.cout',
  ['workspace', 'crees', 'desaccords', 'appuis', 'echecs', 'cout'].every((k) => sw.corps?.[k] !== undefined));

const fw = await call('POST', `/v1/canvas/c1/nodes/${nodeId}/framework`, { nom: 'scamper' });
v('framework -> .workspace + .crees + .echecs', Boolean(fw.corps?.workspace) && Array.isArray(fw.corps?.crees) && Array.isArray(fw.corps?.echecs));

const pm = await call('POST', `/v1/canvas/c1/nodes/${nodeId}/framework`, { nom: 'pre-mortem' });
v('pre-mortem -> .causes + .couverture', Array.isArray(pm.corps?.causes) && pm.corps?.couverture !== undefined);

const mat = await call('POST', '/v1/canvas/c1/matrix', { notes: { [nodeId]: { impact: 8, effort: 2 } } });
v('matrice -> .cellules[] + .evaluees + .nonEvaluees',
  Array.isArray(mat.corps?.cellules) && typeof mat.corps?.evaluees === 'number' && typeof mat.corps?.nonEvaluees === 'number');

const prom = await call('POST', '/v1/canvas/c1/promote', { nodeId });
v('promouvoir -> .idea + .traitement.{hypotheses,cibles}',
  Boolean(prom.corps?.idea?.title) && Array.isArray(prom.corps?.traitement?.hypotheses) && Array.isArray(prom.corps?.traitement?.cibles));

const orig = await call('GET', `/v1/canvas/c1/origin/${prom.corps.idea.id}`);
v('origine -> .workspaceId + .nodes[]', orig.corps?.workspaceId === 'c1' && Array.isArray(orig.corps?.nodes));

const jv = await call('GET', '/v1/canvas/c1/journal/verify');
v('verifierJournal -> .ok', typeof jv.corps?.ok === 'boolean');

const err = await call('POST', '/v1/canvas/c1/edges', { from: nodeId, to: nodeId, relation: 'soutient' });
v('erreur metier -> statut 4xx + .error lisible', err.statut >= 400 && err.statut < 500 && typeof err.corps?.error === 'string');

await app.close(); await db.close();
console.log(`\n${'='.repeat(56)}`);
console.log(`CONTRAT API — ${ok} vérifications, ${echecs.length} échec(s)`);
if (echecs.length) for (const e of echecs) console.log(`  - ${e}`);
console.log('='.repeat(56));
process.exit(echecs.length ? 1 : 0);
