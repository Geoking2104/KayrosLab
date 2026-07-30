// KayrosLab — Canvas v12 : identite agent, journal chaine, reconciliation.
// EF-220, EF-221, EF-240 a EF-247.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonical, sha256, generateKeyPair, sign, verify, toBase64Url, fromBase64Url,
  createAgentIdentity, AgentRegistry, signProduction, verifyProduction, filterSigned,
  canAct, ACTIONS_INTERDITES_AGENT,
} from './identity.mjs';
import { EventLog, Recorder, replay, applyEvent, diffEtats, verifyJSONL, hashEvent, TYPES_EVENEMENT } from './journal.mjs';
import { mergeWorkspaces, mergeAll, reconcilier, OfflineQueue, snapshotReseau, empreinte } from './sync.mjs';
import { createWorkspace, createNode, addNode, updateNode, removeNode, addEdge, getNode } from './model.mjs';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ==========================================================================
// Primitives
// ==========================================================================

test('canonical trie les cles recursivement — meme contenu, meme forme', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical({ x: { d: 1, c: 2 } }), '{"x":{"c":2,"d":1}}');
  assert.equal(canonical([3, 1]), '[3,1]', "l'ordre d'un tableau est signifiant");
  assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}', 'undefined est ignore');
  assert.equal(canonical(null), 'null');
});

test('base64url fait un aller-retour sans perte', () => {
  const src = new Uint8Array([0, 1, 250, 255, 128]);
  assert.deepEqual([...fromBase64Url(toBase64Url(src))], [...src]);
  assert.equal(/[+/=]/.test(toBase64Url(src)), false, 'alphabet url-safe');
});

test('sha256 est stable et differencie', async () => {
  assert.equal(await sha256('a'), await sha256('a'));
  assert.notEqual(await sha256('a'), await sha256('b'));
});

// ==========================================================================
// EF-240 / EF-242 — identite et signature
// ==========================================================================

test('EF-240 une identite d agent porte sa cle et ne peut pas resoudre un gate', async () => {
  const { identite, privateKey } = await createAgentIdentity({ id: 'a1', persona: 'Critic', tenantId: 't1' });
  assert.equal(identite.kind, 'agent');
  assert.equal(identite.canResolveGate, false);
  assert.ok(identite.publicKey.length > 20);
  assert.ok(privateKey.length > 20);
  assert.equal(identite.privateKey, undefined, 'la cle privee ne fuit pas dans l identite publique');
  await assert.rejects(() => createAgentIdentity({ persona: 'X' }), /id requis/);
  await assert.rejects(() => createAgentIdentity({ id: 'a' }), /persona requise/);
});

test('EF-242 une production signee est verifiable, une production alteree ne l est pas', async () => {
  const { identite, privateKey } = await createAgentIdentity({ id: 'a1', persona: 'RedTeam' });
  const reg = new AgentRegistry().register(identite);
  const signee = await signProduction({ type: 'critique', titre: 'Kill shot', corps: 'detail', authorId: 'a1' }, privateKey);

  assert.equal((await verifyProduction(signee, reg)).valide, true);
  assert.equal((await verifyProduction({ ...signee, titre: 'Autre' }, reg)).valide, false);
  assert.equal((await verifyProduction({ ...signee, corps: 'modifie' }, reg)).valide, false);
});

test('EF-242 une production NON signee est refusee, pas simplement signalee', async () => {
  const { identite } = await createAgentIdentity({ id: 'a1', persona: 'Critic' });
  const reg = new AgentRegistry().register(identite);
  const r = await verifyProduction({ type: 'critique', titre: 'X', authorId: 'a1' }, reg);
  assert.equal(r.valide, false);
  assert.match(r.motif, /non signee/);

  const inconnu = await verifyProduction({ titre: 'X', authorId: 'fantome', signature: 'zzz' }, reg);
  assert.match(inconnu.motif, /agent inconnu/);
});

test('EF-242 filterSigned ne laisse passer que le valide et motive chaque rejet', async () => {
  const { identite, privateKey } = await createAgentIdentity({ id: 'a1', persona: 'Critic' });
  const reg = new AgentRegistry().register(identite);
  const bonne = await signProduction({ type: 'critique', titre: 'Vraie', authorId: 'a1' }, privateKey);
  const r = await filterSigned([bonne, { type: 'critique', titre: 'Fausse', authorId: 'a1' }], reg);
  assert.equal(r.valides.length, 1);
  assert.equal(r.rejetees.length, 1);
  assert.match(r.rejetees[0].motif, /non signee/);
});

test('une signature faite avec une autre cle est rejetee', async () => {
  const a = await createAgentIdentity({ id: 'a1', persona: 'Critic' });
  const b = await createAgentIdentity({ id: 'a2', persona: 'RedTeam' });
  const reg = new AgentRegistry().register(a.identite);
  // Signe avec la cle de a2 mais attribue a a1 : usurpation.
  const usurpee = await signProduction({ type: 'critique', titre: 'X', authorId: 'a1' }, b.privateKey);
  assert.equal((await verifyProduction(usurpee, reg)).valide, false);
});

// ==========================================================================
// EF-241 — appartenance
// ==========================================================================

test('EF-241 l appartenance definit le perimetre et se retire comme pour un humain', async () => {
  const { identite } = await createAgentIdentity({ id: 'a1', persona: 'Critic' });
  const reg = new AgentRegistry().register(identite);
  assert.equal(reg.isMember('a1', 'w1'), false);
  reg.join('a1', 'w1');
  assert.equal(reg.isMember('a1', 'w1'), true);
  reg.join('a1', 'w1');
  assert.equal(reg.get('a1').memberships.length, 1, 'adhesion idempotente');
  assert.equal(reg.membersOf('w1').length, 1);
  reg.leave('a1', 'w1');
  assert.equal(reg.isMember('a1', 'w1'), false);
  assert.throws(() => reg.join('fantome', 'w1'), /introuvable/);
});

test('le registre refuse une identite non-agent ou pretendant resoudre un gate', async () => {
  const { identite } = await createAgentIdentity({ id: 'a1', persona: 'Critic' });
  const reg = new AgentRegistry();
  assert.throws(() => reg.register({ id: 'h1', kind: 'human' }), /identite d agent requise/);
  assert.throws(() => reg.register({ ...identite, canResolveGate: true }), /ne peut pas resoudre un gate/);
});

// ==========================================================================
// EF-243 — perimetre d'action
// ==========================================================================

test('EF-243 un agent ne peut ni resoudre un gate ni exercer un veto', () => {
  const agent = { id: 'a1', kind: 'agent' };
  for (const action of ACTIONS_INTERDITES_AGENT) {
    const r = canAct(agent, action);
    assert.equal(r.autorise, false, `${action} doit etre refusee`);
    assert.ok(r.motif);
  }
  assert.match(canAct(agent, 'gate.resolve').motif, /instruit, il ne tranche pas/);
});

test('EF-243 un humain n est pas contraint par la liste blanche', () => {
  const humain = { id: 'h1', kind: 'human' };
  assert.equal(canAct(humain, 'gate.resolve').autorise, true);
  assert.equal(canAct(humain, 'action.exotique').autorise, true);
});

test('EF-243 une action inconnue est refusee par defaut a un agent', () => {
  const agent = { id: 'a1', kind: 'agent' };
  assert.equal(canAct(agent, 'node.add').autorise, true);
  assert.equal(canAct(agent, 'vote.advisory').autorise, true, 'le vote consultatif reste ouvert');
  assert.equal(canAct(agent, 'action.inventee').autorise, false, 'liste blanche : refus par defaut');
  assert.equal(canAct(null, 'node.add').autorise, false);
});

test('EF-243 la liste des interdits est gelee — la frontiere n est pas negociable', () => {
  assert.throws(() => { ACTIONS_INTERDITES_AGENT.push('x'); }, TypeError);
  assert.ok(ACTIONS_INTERDITES_AGENT.includes('veto'));
  assert.ok(ACTIONS_INTERDITES_AGENT.includes('gate.resolve'));
});

// ==========================================================================
// EF-244 / EF-245 — journal chaine
// ==========================================================================

test('EF-244 chaque evenement porte son rang, son auteur et son chainage', async () => {
  const log = new EventLog();
  const e0 = await log.append({ type: 'workspace.create', workspaceId: 'w1', payload: { id: 'w1', nom: 'A' }, actorId: 'geoffroy' });
  const e1 = await log.append({ type: 'node.add', workspaceId: 'w1', payload: { id: 'n1', titre: 'X' }, actorId: 'Critic', actorKind: 'agent' });
  assert.equal(e0.seq, 0);
  assert.equal(e0.prevHash, 'genesis');
  assert.equal(e1.prevHash, e0.hash);
  assert.equal(e1.actorKind, 'agent');
  assert.equal(log.tete, e1.hash);
  await assert.rejects(() => log.append({ type: 'inconnu', workspaceId: 'w1' }), /type inconnu/);
  await assert.rejects(() => log.append({ type: 'node.add' }), /workspaceId requis/);
  assert.ok(TYPES_EVENEMENT.includes('promote'));
});

test('EF-245 une alteration de contenu est detectee et localisee', async () => {
  const log = new EventLog();
  await log.append({ type: 'workspace.create', workspaceId: 'w1', payload: { id: 'w1', nom: 'A' } });
  await log.append({ type: 'node.add', workspaceId: 'w1', payload: { id: 'n1', titre: 'Vrai' } });
  await log.append({ type: 'node.add', workspaceId: 'w1', payload: { id: 'n2', titre: 'Autre' } });
  assert.deepEqual((await log.verify()).ok, true);

  const evts = log.events();
  evts[1].payload.titre = 'Falsifie';
  const casse = new EventLog(evts);
  const v = await casse.verify();
  assert.equal(v.ok, false);
  assert.equal(v.seq, 1, 'la rupture est localisee, pas seulement signalee');
  assert.match(v.motif, /altere/);
});

test('EF-245 une suppression au milieu de la chaine est detectee', async () => {
  const log = new EventLog();
  for (const p of [{ id: 'w1', nom: 'A' }, { id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }]) {
    await log.append({ type: p.nom ? 'workspace.create' : 'node.add', workspaceId: 'w1', payload: p });
  }
  const evts = log.events();
  const ampute = new EventLog([evts[0], evts[2]]);
  const v = await ampute.verify();
  assert.equal(v.ok, false);
  assert.match(v.motif, /chainage rompu/);
});

test('EF-245 un evenement signe est verifie contre le registre', async () => {
  const { identite, privateKey } = await createAgentIdentity({ id: 'Critic', persona: 'Critic' });
  const reg = new AgentRegistry().register(identite);
  const log = new EventLog();
  await log.append({ type: 'workspace.create', workspaceId: 'w1', payload: { id: 'w1', nom: 'A' } });
  await log.append({ type: 'node.add', workspaceId: 'w1', payload: { id: 'n1', titre: 'X' }, actorId: 'Critic', actorKind: 'agent', privateKey });

  assert.equal((await log.verify({ registry: reg })).ok, true);
  const evts = log.events();
  evts[1].sig = await sign({ faux: true }, privateKey);
  assert.match((await new EventLog(evts).verify({ registry: reg })).motif, /signature invalide/);
});

// ==========================================================================
// EF-246 — rejeu
// ==========================================================================

test('EF-246 le rejeu reproduit exactement l etat construit en direct', async () => {
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { id: 'n1', titre: 'Idee' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { id: 'n2', titre: 'Autre' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'edge.add', payload: { id: 'e1', from: 'n1', to: 'n2', relation: 'soutient' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.update', payload: { id: 'n1', patch: { titre: 'Idee revisee' } } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.pin', payload: { id: 'n2', pinned: true } }));

  const rj = replay(r.log, 'w1');
  assert.equal(rj.appliques, 6);
  assert.deepEqual(rj.ignores, []);
  assert.equal(diffEtats(ws, rj.workspace).identiques, true);
  assert.equal(getNode(rj.workspace, 'n1').titre, 'Idee revisee');
  assert.equal(getNode(rj.workspace, 'n2').pinned, true);
});

test('EF-246 le rejeu survit a une suppression et a une promotion', async () => {
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { id: 'n1', titre: 'A' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { id: 'n2', titre: 'B' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.remove', payload: { id: 'n2' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'promote', payload: { ideaId: 'i1', nodeIds: ['n1'] } }));

  const rj = replay(r.log, 'w1');
  assert.equal(diffEtats(ws, rj.workspace).identiques, true);
  assert.equal(rj.workspace.nodes.length, 1);
  assert.deepEqual(rj.workspace.promotedIdeaIds, ['i1']);
});

test('EF-246 un evenement sans id explicite reste rejouable (regression recette P2)', async () => {
  // Les tests fournissaient toujours un id ; un client normal ne le fait pas.
  // `createNode` generait alors un UUID different a chaque rejeu et l'etat
  // reconstruit divergeait. Le Recorder fige desormais l'id avant journalisation.
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { titre: 'Sans id explicite' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { titre: 'Second sans id' } }));
  ({ workspace: ws } = await r.record(ws, { type: 'edge.add', payload: { from: ws.nodes[0].id, to: ws.nodes[1].id, relation: 'soutient' } }));

  assert.ok(r.log.events()[1].payload.id, "l'identifiant est fige dans l'evenement");
  const rj = replay(r.log, 'w1');
  assert.equal(diffEtats(ws, rj.workspace).identiques, true, 'le rejeu reproduit les memes identifiants');
  assert.equal(replay(r.log, 'w1').workspace.nodes[0].id, rj.workspace.nodes[0].id, 'deux rejeux successifs concordent');
});

test('EF-242/246 le rejeu conserve l attribution aux agents (regression)', async () => {
  // `applyEvent` construisait les noeuds sans reprendre l'acteur de
  // l'evenement : une production d'agent revenait `human` au rejeu, et l'audit
  // reconstruit mentait sur son auteur. `diffEtats` ne comparait pas non plus
  // l'attribution — la divergence restait donc invisible.
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { titre: 'Humaine' }, actorId: 'alice', actorKind: 'human' }));
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { titre: 'Critique' }, actorId: 'Critic', actorKind: 'agent' }));
  ({ workspace: ws } = await r.record(ws, {
    type: 'edge.add',
    payload: { from: ws.nodes[1].id, to: ws.nodes[0].id, relation: 'contredit' },
    actorId: 'Critic', actorKind: 'agent',
  }));

  const rejoue = replay(r.log, 'w1').workspace;
  assert.equal(rejoue.nodes[1].authorKind, 'agent', "l'origine agent survit au rejeu");
  assert.equal(rejoue.nodes[1].authorId, 'Critic');
  assert.equal(rejoue.nodes[0].authorKind, 'human');
  assert.equal(rejoue.edges[0].authorKind, 'agent');
  assert.equal(diffEtats(ws, rejoue).identiques, true);

  // diffEtats doit VOIR une divergence d'attribution.
  const falsifie = { ...rejoue, nodes: rejoue.nodes.map((n, i) => (i === 1 ? { ...n, authorKind: 'human', authorId: 'alice' } : n)) };
  assert.equal(diffEtats(ws, falsifie).identiques, false, 'une attribution changee est detectee');
});

test('EF-246 un evenement irrejouable est signale, jamais avale', () => {
  const evts = [
    { seq: 0, type: 'workspace.create', workspaceId: 'w1', payload: { id: 'w1', nom: 'A' }, ts: '2026-01-01T00:00:00Z' },
    { seq: 1, type: 'node.update', workspaceId: 'w1', payload: { id: 'fantome', patch: { titre: 'X' } }, ts: '2026-01-01T00:00:01Z' },
    { seq: 2, type: 'node.add', workspaceId: 'w1', payload: { id: 'n1', titre: 'OK' }, ts: '2026-01-01T00:00:02Z' },
  ];
  const rj = replay(evts, 'w1');
  assert.equal(rj.appliques, 2);
  assert.equal(rj.ignores.length, 1);
  assert.equal(rj.ignores[0].seq, 1);
  assert.match(rj.ignores[0].motif, /introuvable/);
  assert.equal(rj.workspace.nodes.length, 1, 'le rejeu continue apres l incident');
});

test('EF-246 un journal sans creation de workspace ne fabrique pas d etat', () => {
  const rj = replay([{ seq: 0, type: 'node.add', workspaceId: 'w1', payload: { id: 'n1', titre: 'X' }, ts: '2026-01-01T00:00:00Z' }], 'w1');
  assert.equal(rj.workspace, null);
  assert.match(rj.ignores[0].motif, /aucun workspace/);
  assert.throws(() => applyEvent(null, { type: 'inconnu' }), /non gere/);
});

// ==========================================================================
// EF-247 — export et verification hors ligne
// ==========================================================================

test('EF-247 l export JSONL est verifiable sans le systeme d origine', async () => {
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  await r.record(ws, { type: 'node.add', payload: { id: 'n1', titre: 'X' } });

  const jsonl = r.log.toJSONL();
  assert.equal(jsonl.split('\n').length, 2);
  assert.equal((await verifyJSONL(jsonl)).ok, true);

  const lignes = jsonl.split('\n');
  const o = JSON.parse(lignes[1]); o.payload.titre = 'PIRATE'; lignes[1] = JSON.stringify(o);
  const v = await verifyJSONL(lignes.join('\n'));
  assert.equal(v.ok, false);
  assert.equal(v.seq, 1);

  assert.equal((await verifyJSONL('ceci n est pas du json')).ok, false, 'un export illisible est declare tel');
  assert.equal((await verifyJSONL('')).ok, true, 'un journal vide est valide');
});

test('EF-247 un aller-retour JSONL preserve le rejeu', async () => {
  const r = new Recorder();
  let { workspace: ws } = await r.record(null, { type: 'workspace.create', payload: { id: 'w1', nom: 'A' } });
  ({ workspace: ws } = await r.record(ws, { type: 'node.add', payload: { id: 'n1', titre: 'X' } }));
  const relu = EventLog.fromJSONL(r.log.toJSONL());
  assert.equal(diffEtats(ws, replay(relu, 'w1').workspace).identiques, true);
});

test('hashEvent ignore hash et sig — sinon le chainage serait circulaire', async () => {
  const e = { seq: 0, prevHash: 'genesis', type: 'node.add', actorId: null, actorKind: 'human', workspaceId: 'w1', payload: {}, ts: '2026-01-01T00:00:00Z' };
  const h = await hashEvent(e);
  assert.equal(await hashEvent({ ...e, hash: 'x', sig: 'y' }), h);
});

// ==========================================================================
// EF-220 / EF-221 — reconciliation
// ==========================================================================

function base() {
  let ws = createWorkspace({ id: 'w1', nom: 'Atelier', ts: '2026-01-01T00:00:00.000Z' });
  ws = addNode(ws, createNode({ id: 'n1', titre: 'Commun', ts: '2026-01-01T00:00:00.000Z' }));
  return ws;
}

test('EF-220 la fusion est commutative, idempotente et associative', async () => {
  const a0 = base();
  const a = addNode(a0, createNode({ id: 'na', titre: 'Alice', ts: '2026-01-02T00:00:00.000Z' }));
  const b = addNode(a0, createNode({ id: 'nb', titre: 'Bob', ts: '2026-01-02T00:00:00.000Z' }));
  const c = addNode(a0, createNode({ id: 'nc', titre: 'Carol', ts: '2026-01-02T00:00:00.000Z' }));

  const ab = mergeWorkspaces(a, b);
  const ba = mergeWorkspaces(b, a);
  assert.equal(empreinte(ab), empreinte(ba), 'commutativite');
  assert.equal(ab.nodes.length, 3, 'aucun ajout concurrent perdu');

  assert.equal(empreinte(mergeWorkspaces(a, a)), empreinte(a), 'idempotence');
  assert.equal(
    empreinte(mergeWorkspaces(mergeWorkspaces(a, b), c)),
    empreinte(mergeWorkspaces(a, mergeWorkspaces(b, c))),
    'associativite',
  );
  assert.equal(empreinte(mergeAll(a, b, c)), empreinte(mergeAll(c, b, a)));
});

test('EF-220 sur modification concurrente, la plus recente gagne de facon deterministe', async () => {
  const a0 = base();
  const a = updateNode(a0, 'n1', { titre: 'Version Alice' });
  await attendre(5);
  const b = updateNode(a0, 'n1', { titre: 'Version Bob' });

  const f1 = mergeWorkspaces(a, b);
  const f2 = mergeWorkspaces(b, a);
  assert.equal(getNode(f1, 'n1').titre, 'Version Bob', 'la plus recente l emporte');
  assert.equal(getNode(f2, 'n1').titre, getNode(f1, 'n1').titre, 'meme resultat quel que soit l ordre');
});

test('EF-220 a horodatage identique le departage reste deterministe', () => {
  const a0 = base();
  const ts = '2026-06-01T00:00:00.000Z';
  const a = { ...a0, nodes: [{ ...a0.nodes[0], titre: 'AAA', updatedAt: ts }] };
  const b = { ...a0, nodes: [{ ...a0.nodes[0], titre: 'ZZZ', updatedAt: ts }] };
  assert.equal(getNode(mergeWorkspaces(a, b), 'n1').titre, getNode(mergeWorkspaces(b, a), 'n1').titre);
});

test('EF-220 une suppression se propage grace a la pierre tombale', async () => {
  const a0 = base();
  const avecN2 = addNode(a0, createNode({ id: 'n2', titre: 'A supprimer', ts: '2026-01-02T00:00:00.000Z' }));
  await attendre(5);
  const supprime = removeNode(avecN2, 'n2');

  assert.equal(supprime.tombstones.length, 1);
  const fusion = mergeWorkspaces(avecN2, supprime);
  assert.equal(fusion.nodes.find((n) => n.id === 'n2'), undefined, 'le noeud ne ressuscite pas');
  assert.equal(mergeWorkspaces(supprime, avecN2).nodes.length, fusion.nodes.length, 'independant de l ordre');
});

test('EF-220 une modification posterieure a la suppression l emporte', async () => {
  const a0 = addNode(base(), createNode({ id: 'n2', titre: 'X', ts: '2026-01-02T00:00:00.000Z' }));
  const supprime = removeNode(a0, 'n2');
  await attendre(5);
  const modifie = updateNode(a0, 'n2', { titre: 'Repris et enrichi' });

  const f = mergeWorkspaces(supprime, modifie);
  assert.ok(f.nodes.find((n) => n.id === 'n2'), 'une reprise posterieure prime sur une suppression anterieure');
  assert.equal(empreinte(f), empreinte(mergeWorkspaces(modifie, supprime)));
});

test('EF-220 la suppression d un noeud emporte ses aretes a la fusion', async () => {
  let a0 = base();
  a0 = addNode(a0, createNode({ id: 'n2', titre: 'B', ts: '2026-01-02T00:00:00.000Z' }));
  a0 = addEdge(a0, { id: 'e1', from: 'n1', to: 'n2', relation: 'soutient' });
  await attendre(5);
  const supprime = removeNode(a0, 'n2');
  const f = mergeWorkspaces(a0, supprime);
  assert.equal(f.edges.length, 0, 'aucune arete orpheline apres fusion');
});

test('EF-216 un libelle humain survit a la fusion meme si l autre etat est plus recent', async () => {
  const a0 = base();
  const humain = {
    ...a0, updatedAt: '2026-01-01T00:00:00.000Z',
    clusters: [{ id: 'c1', label: 'Mobilite', labelSource: 'human', nodeIds: ['n1'], createdAt: a0.createdAt }],
  };
  const machine = {
    ...a0, updatedAt: '2026-06-01T00:00:00.000Z',
    clusters: [{ id: 'c1', label: 'Theme 3', labelSource: 'llm', nodeIds: ['n1'], createdAt: a0.createdAt }],
  };
  assert.equal(mergeWorkspaces(humain, machine).clusters[0].label, 'Mobilite');
  assert.equal(mergeWorkspaces(machine, humain).clusters[0].label, 'Mobilite');
});

test('la fusion refuse deux workspaces distincts et tolere un cote absent', () => {
  const a = base();
  const b = createWorkspace({ id: 'w2', nom: 'Autre' });
  assert.throws(() => mergeWorkspaces(a, b), /workspaces distincts/);
  assert.equal(mergeWorkspaces(a, null), a);
  assert.equal(mergeWorkspaces(null, a), a);
  assert.equal(mergeAll(), null);
});

test("EF-220 l'historique est une union dedupliquee, jamais tronquee", async () => {
  const a0 = base();
  const a = addNode(a0, createNode({ id: 'na', titre: 'A', ts: '2026-01-02T00:00:00.000Z' }));
  await attendre(5);
  const b = addNode(a0, createNode({ id: 'nb', titre: 'B', ts: '2026-01-03T00:00:00.000Z' }));
  const f = mergeWorkspaces(a, b);
  assert.equal(f.history.length, 4, 'creation + n1 + na + nb');
  const ts = f.history.map((h) => h.ts);
  assert.deepEqual(ts, [...ts].sort(), 'historique ordonne chronologiquement');
});

// ==========================================================================
// EF-221 — hors ligne
// ==========================================================================

test('EF-221 la file hors ligne accumule, se vide et refuse le debordement', () => {
  const q = new OfflineQueue({ limite: 2 });
  assert.equal(q.vide, true);
  q.enfiler({ type: 'node.add', payload: { id: 'n1' } });
  q.enfiler({ type: 'node.add', payload: { id: 'n2' } });
  assert.equal(q.taille, 2);
  assert.throws(() => q.enfiler({ type: 'node.add' }), /limite de 2/);
  assert.equal(q.vider().length, 2);
  assert.equal(q.vide, true);
});

test('EF-221 la reconciliation ne perd rien et signale les conflits', async () => {
  const a0 = base();
  const local = updateNode(addNode(a0, createNode({ id: 'hors-ligne', titre: 'Cree sans reseau', ts: '2026-01-02T00:00:00.000Z' })), 'n1', { titre: 'Titre local' });
  await attendre(5);
  const distant = updateNode(addNode(a0, createNode({ id: 'distant', titre: 'Cree ailleurs', ts: '2026-01-02T00:00:00.000Z' })), 'n1', { titre: 'Titre distant' });

  const { workspace, conflits } = reconcilier(local, distant);
  assert.ok(workspace.nodes.find((n) => n.id === 'hors-ligne'), 'le travail hors ligne est conserve');
  assert.ok(workspace.nodes.find((n) => n.id === 'distant'), 'le travail distant est conserve');
  assert.equal(conflits.length, 1, 'le conflit sur n1 est signale');
  assert.equal(conflits[0].titreLocal, 'Titre local');
  assert.equal(conflits[0].titreRetenu, 'Titre distant');
  assert.ok(conflits[0].versionLocalePerdue, 'la version supplantee reste recuperable');
});

test('EF-221 sans divergence la reconciliation ne signale aucun conflit', () => {
  const a = base();
  const { conflits } = reconcilier(a, a);
  assert.deepEqual(conflits, []);
});

test('le snapshot reseau allege l historique sans perdre l etat', () => {
  const ws = addNode(base(), createNode({ id: 'n2', titre: 'B' }));
  const s = snapshotReseau(ws);
  assert.deepEqual(s.history, []);
  assert.equal(s.nodes.length, 2);
  assert.equal(empreinte(s), empreinte(ws), 'meme empreinte : rien d essentiel n est omis');
});
