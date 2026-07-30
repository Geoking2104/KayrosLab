#!/usr/bin/env node
// KayrosLab — Temps reel : diffusion, presence, reconciliation, streaming.
// EF-220, EF-221, EF-230.

import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { pgliteAsPool } from '../lib/pglite-pool.mjs';
import { PostgresCanvasRepository } from '../lib/canvas-postgres.mjs';
import { CanvasHub } from '../lib/canvas-hub.mjs';
import { createEngine } from '../../../core/index.mjs';
import { createCanvasStudio, createNode, addNode, mergeWorkspaces, empreinte } from '../../../core/canvas/index.mjs';
import canvasRoutes from '../routes/canvas.mjs';
import streamRoutes from '../routes/canvas-stream.mjs';

let ok = 0; const echecs = [];
const etape = (n) => process.stdout.write(`\n\x1b[1m${n}\x1b[0m\n`);
const v = (l, c, d = '') => { if (c) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${l}`); } else { echecs.push(l); console.log(`  \x1b[31mKO\x1b[0m  ${l}${d ? ` — ${d}` : ''}`); } };

const db = new PGlite();
await db.exec(await readFile(new URL('../migrations/001_canvas.sql', import.meta.url), 'utf8'));
const pool = pgliteAsPool(db);
const repo = new PostgresCanvasRepository({ pool });
const engine = createEngine({});
const studio = createCanvasStudio(engine, { repository: repo });
const hub = new CanvasHub({ repo, battementMs: 60_000 });

const app = Fastify({ logger: false });
app.decorate('requireAuth', async (req, reply) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) { reply.code(401).send({ error: 'jeton requis' }); return null; }
  const [email, tenantId] = h.slice(7).split('@@');
  return { email, tenantId: tenantId || 'tr' };
});
app.decorate('kayrosContext', { canvas: studio, engine, canvasHub: hub, ideas: { save: async () => {} } });
await app.register(canvasRoutes);
await app.register(streamRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;

const call = async (m, c, b, jeton = 'alice@k.com@@tr') => {
  const r = await fetch(`${base}${c}`, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  try { return { statut: r.status, corps: JSON.parse(t) }; } catch { return { statut: r.status, corps: t }; }
};

/** Client SSE minimal : `EventSource` n'existe pas dans Node. */
function ecouter(chemin, jeton) {
  const ctrl = new AbortController();
  const recus = [];
  const pret = fetch(`${base}${chemin}`, { headers: { authorization: `Bearer ${jeton}` }, signal: ctrl.signal })
    .then(async (res) => {
      const lecteur = res.body.getReader();
      const dec = new TextDecoder();
      let tampon = '';
      while (true) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value, { stream: true });
        const blocs = tampon.split('\n\n');
        tampon = blocs.pop();
        for (const bloc of blocs) {
          if (bloc.startsWith(':')) { recus.push({ type: 'battement' }); continue; }
          const type = bloc.match(/^event: (.+)$/m)?.[1];
          const data = bloc.match(/^data: (.+)$/m)?.[1];
          if (type) recus.push({ type, data: data ? JSON.parse(data) : null });
        }
      }
    }).catch(() => { /* abort attendu */ });
  return { recus, fermer: () => ctrl.abort(), pret };
}
const patiente = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = async (recus, type, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = recus.find((x) => x.type === type);
    if (e) return e;
    await patiente(25);
  }
  return null;
};

try {
  // ======================================================================
  etape('1. Abonnement et présence');

  await call('POST', '/v1/canvas', { id: 'tr1', nom: 'Temps réel' });

  const alice = ecouter('/v1/canvas/tr1/stream', 'alice@k.com@@tr');
  v('Alice reçoit le message de bienvenue', Boolean(await attendre(alice.recus, 'bienvenue')));

  const bob = ecouter('/v1/canvas/tr1/stream', 'bob@k.com@@tr');
  await attendre(bob.recus, 'bienvenue');
  await patiente(120);

  const presence = await call('GET', '/v1/canvas/tr1/presence');
  v('la présence liste les deux participants', presence.corps.presence?.length === 2, `${presence.corps.presence?.length}`);
  v('Alice est notifiée de l’arrivée de Bob', Boolean(await attendre(alice.recus, 'presence')));

  const intrus = await call('GET', '/v1/canvas/tr1/presence', null, 'mallory@x.com@@autre');
  v('404 pour un autre tenant sur le flux', intrus.statut === 404);

  // ======================================================================
  etape('2. Diffusion des mutations (EF-220)');

  const avant = bob.recus.filter((x) => x.type === 'etat').length;
  await call('POST', '/v1/canvas/tr1/nodes', { titre: 'Idée créée par Alice' });
  const etat = await attendre(bob.recus, 'etat');
  v('Bob reçoit le nouvel état sans l’avoir demandé', Boolean(etat));
  v('l’état diffusé contient le nœud', etat?.data?.nodes?.some((n) => n.titre === 'Idée créée par Alice'));
  v('le snapshot est allégé de l’historique', Array.isArray(etat?.data?.history) && etat.data.history.length === 0);

  const nodeId = etat.data.nodes.at(-1).id;
  await call('PATCH', `/v1/canvas/tr1/nodes/${nodeId}`, { titre: 'Titre révisé' });
  await patiente(150);
  v('une mise à jour est également diffusée',
    bob.recus.filter((x) => x.type === 'etat').length > avant + 1);

  // ======================================================================
  etape('3. Réconciliation d’un travail hors ligne (EF-221)');

  // Bob a travaillé sans réseau : son état contient un nœud que le serveur ignore.
  const serveur = (await call('GET', '/v1/canvas/tr1')).corps.workspace;
  const horsLigne = addNode(serveur, createNode({ id: 'n-hors-ligne', titre: 'Créé sans réseau' }));

  const sync = await call('POST', '/v1/canvas/tr1/sync', { workspace: horsLigne });
  v('la réconciliation aboutit', sync.statut === 200 && sync.corps.fusionne === true);
  v('le travail hors ligne est conservé',
    sync.corps.workspace.nodes.some((n) => n.id === 'n-hors-ligne'));
  v('le travail déjà présent n’est pas perdu',
    sync.corps.workspace.nodes.some((n) => n.id === nodeId));

  const rejeu = await call('POST', '/v1/canvas/tr1/sync', { workspace: horsLigne });
  v('une seconde synchronisation identique ne change rien (idempotence)', rejeu.corps.fusionne === false);

  const enBase = await repo.get('tr1');
  v('la fusion est persistée', enBase.nodes.some((n) => n.id === 'n-hors-ligne'));

  // Commutativité sur les données réelles du parcours.
  const a2 = addNode(enBase, createNode({ id: 'x1', titre: 'Pair A' }));
  const b2 = addNode(enBase, createNode({ id: 'x2', titre: 'Pair B' }));
  v('la fusion reste commutative sur l’état réel',
    empreinte(mergeWorkspaces(a2, b2)) === empreinte(mergeWorkspaces(b2, a2)));

  // ======================================================================
  etape('4. Swarm streamé (EF-230)');

  const flux = ecouter(`/v1/canvas/tr1/nodes/${nodeId}/swarm/stream?personaIds=vc-sceptique,client-cible`, 'alice@k.com@@tr');
  const fin = await attendre(flux.recus, 'fin', 8000);
  const personas = flux.recus.filter((x) => x.type === 'persona');

  v('chaque persona est émise séparément', personas.length === 2, `${personas.length} émission(s)`);
  v('une émission arrive avant la fin', personas.length > 0 && flux.recus.indexOf(personas[0]) < flux.recus.indexOf(fin));
  v('le coût est exposé pendant le flux', typeof personas[0]?.data?.cout?.appels === 'number');
  v('l’événement final récapitule', Array.isArray(fin?.data?.crees) && fin.data.crees.length === 2);
  flux.fermer();

  const apresSwarm = await attendre(bob.recus, 'etat', 2000);
  v('le résultat du swarm est diffusé aux autres', Boolean(apresSwarm));

  // ======================================================================
  etape('5. Fermeture propre');

  alice.fermer(); bob.fermer();
  await patiente(200);
  v('les abonnés sont retirés à la déconnexion', hub.stats().abonnes === 0, JSON.stringify(hub.stats()));

} catch (e) {
  console.error(`\n\x1b[31mInterruption : ${e.message}\x1b[0m\n${e.stack}`);
  echecs.push(`exception : ${e.message}`);
} finally {
  hub.fermerTout();
  await app.close();
  await db.close();
}

console.log(`\n${'='.repeat(58)}`);
console.log(`TEMPS RÉEL — ${ok} vérifications, ${echecs.length} échec(s)`);
if (echecs.length) for (const e of echecs) console.log(`  - ${e}`);
console.log('='.repeat(58));
process.exit(echecs.length ? 1 : 0);
