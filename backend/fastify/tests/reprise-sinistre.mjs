#!/usr/bin/env node
// KayrosLab — Reprise apres sinistre par rejeu du journal (EF-246).
//
// EF-246 promet que « l'etat d'un canvas est reconstructible par rejeu du
// journal depuis l'origine ». Les tests unitaires le verifiaient sur un journal
// en memoire. Ici on eprouve la promesse en conditions de PERTE REELLE : on
// detruit la table des canvas et l'on reconstruit tout depuis `canvas_event`.
//
// C'est la difference entre « le code sait rejouer » et « on peut vraiment
// recuperer » — la meme difference qu'entre avoir une sauvegarde et l'avoir
// restauree une fois.
//
//   node backend/fastify/tests/reprise-sinistre.mjs

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { pgliteAsPool } from '../lib/pglite-pool.mjs';
import { PostgresCanvasRepository, PostgresEventLog } from '../lib/canvas-postgres.mjs';
import { Recorder, replay, diffEtats, verifyJSONL, EventLog } from '../../../core/canvas/index.mjs';

let ok = 0; const echecs = [];
const etape = (n) => process.stdout.write(`\n\x1b[1m${n}\x1b[0m\n`);
const v = (l, c, d = '') => { if (c) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${l}`); } else { echecs.push(l); console.log(`  \x1b[31mKO\x1b[0m  ${l}${d ? ` — ${d}` : ''}`); } };

const db = new PGlite();
await db.exec(await readFile(new URL('../migrations/001_canvas.sql', import.meta.url), 'utf8'));
const pool = pgliteAsPool(db);
const repo = new PostgresCanvasRepository({ pool });
const journal = new PostgresEventLog({ pool });

try {
  // ======================================================================
  etape('1. Construction d’une session complète, tout journalisé');

  const rec = new Recorder();
  const WS = 'ws-sinistre';
  let ws = (await rec.record(null, { type: 'workspace.create', payload: { id: WS, nom: 'Session à sauver', tenantId: 'acme' } })).workspace;

  const titres = [
    'Offre solaire en autoconsommation',
    'Mutualisation entre PME voisines',
    'Le marché est déjà saturé',
    'Quel segment viser en priorité ?',
    'Dépend d’un partenariat opérateur',
  ];
  const ids = [];
  for (const titre of titres) {
    const r = await rec.record(ws, { type: 'node.add', payload: { titre }, actorId: 'alice@acme.com' });
    ws = r.workspace;
    ids.push(r.evenement.payload.id);
  }

  // Aretes, mise a jour, epinglage, suppression, promotion : un parcours
  // representatif, pas seulement des ajouts.
  ws = (await rec.record(ws, { type: 'edge.add', payload: { from: ids[2], to: ids[0], relation: 'contredit' }, actorId: 'critic', actorKind: 'agent' })).workspace;
  ws = (await rec.record(ws, { type: 'edge.add', payload: { from: ids[1], to: ids[0], relation: 'soutient' }, actorId: 'alice@acme.com' })).workspace;
  ws = (await rec.record(ws, { type: 'node.update', payload: { id: ids[0], patch: { titre: 'Offre solaire — version révisée', corps: 'abonnement mensuel' } }, actorId: 'alice@acme.com' })).workspace;
  ws = (await rec.record(ws, { type: 'node.pin', payload: { id: ids[1], pinned: true }, actorId: 'alice@acme.com' })).workspace;
  ws = (await rec.record(ws, { type: 'node.remove', payload: { id: ids[4] }, actorId: 'alice@acme.com' })).workspace;
  ws = (await rec.record(ws, { type: 'cluster.apply', payload: { clusters: [{ id: 'c1', label: 'Solaire partagé', labelSource: 'human', nodeIds: [ids[0], ids[1]], centroid: null, createdAt: new Date().toISOString() }] }, actorId: 'alice@acme.com' })).workspace;
  ws = (await rec.record(ws, { type: 'promote', payload: { ideaId: 'D-2026-001', nodeIds: [ids[0]] }, actorId: 'alice@acme.com' })).workspace;

  await repo.save(ws);
  for (const e of rec.log.events()) await journal.append(e, { tenantId: 'acme' });

  v('la session compte 13 événements', rec.log.longueur === 13, `${rec.log.longueur}`);
  v('l’état final a 4 nœuds (5 créés, 1 supprimé)', ws.nodes.length === 4, `${ws.nodes.length}`);
  v('2 arêtes, dont une contradiction', ws.edges.length === 2 && ws.edges.some((e) => e.relation === 'contredit'));
  v('une idée a été promue', ws.promotedIdeaIds.includes('D-2026-001'));

  const empreinteAvant = JSON.stringify(diffEtats(ws, ws).a);

  // ======================================================================
  etape('2. SINISTRE — perte totale de la table des canvas');

  // La purge est deliberee : elle supprimerait aussi le journal. Ici on simule
  // une perte qui n'atteint QUE les canvas — corruption de table, restauration
  // partielle, erreur d'exploitation. Le journal, lui, a survecu.
  await pool.query("SELECT set_config('kayros.purge', 'off', false)");
  await pool.query('DELETE FROM canvas_workspace WHERE id = $1', [WS]).catch(async () => {
    // La contrainte de cle etrangere protege le journal : on detache d'abord.
    await pool.query('ALTER TABLE canvas_event DROP CONSTRAINT IF EXISTS canvas_event_workspace_id_fkey');
    await pool.query('DELETE FROM canvas_workspace WHERE id = $1', [WS]);
  });

  v('le canvas a bien disparu', (await repo.get(WS)) === null);
  const evtRestants = await pool.query('SELECT count(*)::int AS n FROM canvas_event WHERE workspace_id = $1', [WS]);
  v('le journal a survécu au sinistre', evtRestants.rows[0].n === 13, `${evtRestants.rows[0].n} événements`);

  // ======================================================================
  etape('3. Reconstruction depuis le journal');

  const log = await journal.load(WS);
  const integrite = await log.verify();
  v('la chaîne est intacte avant reconstruction', integrite.ok === true, integrite.motif ?? '');

  const reprise = replay(log, WS);
  v('tous les événements sont rejoués', reprise.appliques === 13, `${reprise.appliques}`);
  v('aucun événement irrejouable', reprise.ignores.length === 0, JSON.stringify(reprise.ignores));
  v('l’état reconstruit est IDENTIQUE à l’original', diffEtats(ws, reprise.workspace).identiques === true);

  // Verification champ par champ : « identique » doit vouloir dire identique.
  const r = reprise.workspace;
  v('les nœuds sont restaurés', r.nodes.length === 4);
  v('la révision de titre est restaurée', r.nodes.find((n) => n.id === ids[0])?.titre === 'Offre solaire — version révisée');
  v('le nœud épinglé l’est toujours', r.nodes.find((n) => n.id === ids[1])?.pinned === true);
  v('le nœud supprimé n’est pas revenu', !r.nodes.some((n) => n.id === ids[4]));
  v('la contradiction est restaurée', r.edges.some((e) => e.relation === 'contredit' && e.from === ids[2]));
  v('le libellé humain du cluster est préservé', r.clusters[0]?.label === 'Solaire partagé' && r.clusters[0]?.labelSource === 'human');
  v('le lien vers l’idée promue est restauré', r.nodes.find((n) => n.id === ids[0])?.promotedIdeaId === 'D-2026-001');
  v('l’attribution aux agents est conservée', r.edges.some((e) => e.authorKind === 'agent'));

  // ======================================================================
  etape('4. Remise en service');

  await repo.save(reprise.workspace);
  const relu = await repo.get(WS);
  v('le canvas reconstruit est persisté', relu !== null);
  v('la relecture en base est fidèle', diffEtats(ws, relu).identiques === true);
  v('l’empreinte est inchangée', JSON.stringify(diffEtats(relu, relu).a) === empreinteAvant);

  // ======================================================================
  etape('5. Sauvegarde froide du journal (export hors base)');

  const jsonl = log.toJSONL();
  v('l’export JSONL contient tout', jsonl.split('\n').length === 13);
  v('l’export se vérifie hors ligne', (await verifyJSONL(jsonl)).ok === true);

  // Scenario extreme : la BASE ENTIERE est perdue, il ne reste que l'export.
  const depuisFichier = replay(EventLog.fromJSONL(jsonl), WS);
  v('reconstruction possible depuis le seul export', diffEtats(ws, depuisFichier.workspace).identiques === true);

  // Un export altere ne doit pas etre restaure en silence.
  const lignes = jsonl.split('\n');
  const o = JSON.parse(lignes[5]); o.payload = { ...o.payload, titre: 'FALSIFIÉ' }; lignes[5] = JSON.stringify(o);
  const altere = await verifyJSONL(lignes.join('\n'));
  v('un export altéré est détecté avant restauration', altere.ok === false && altere.seq === 5, JSON.stringify(altere));

} catch (e) {
  console.error(`\n\x1b[31mInterruption : ${e.message}\x1b[0m\n${e.stack}`);
  echecs.push(`exception : ${e.message}`);
} finally {
  await db.close();
}

console.log(`\n${'='.repeat(58)}`);
console.log(`REPRISE APRÈS SINISTRE — ${ok} vérifications, ${echecs.length} échec(s)`);
if (echecs.length) for (const e of echecs) console.log(`  - ${e}`);
console.log('='.repeat(58));
process.exit(echecs.length ? 1 : 0);
