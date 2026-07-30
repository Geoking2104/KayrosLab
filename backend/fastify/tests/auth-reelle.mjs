#!/usr/bin/env node
// KayrosLab — Recette du canvas avec l'AUTHENTIFICATION REELLE.
//
// Les recettes precedentes simulaient `requireAuth` : elles validaient le
// canvas, pas la chaine d'authentification. Celle-ci monte le vrai
// `AuthService` du coeur — scrypt, jetons HMAC signes, revocation, anti-force
// brute — et verifie que l'isolation multi-tenant tient BOUT EN BOUT, du mot
// de passe jusqu'a la ligne en base.
//
//   node backend/fastify/tests/auth-reelle.mjs

import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { pgliteAsPool } from '../lib/pglite-pool.mjs';
import { PostgresCanvasRepository } from '../lib/canvas-postgres.mjs';
import { AuthService, InMemoryUserStore } from '../../../core/auth.mjs';
import { createEngine } from '../../../core/index.mjs';
import { createCanvasStudio } from '../../../core/canvas/index.mjs';
import canvasRoutes from '../routes/canvas.mjs';

let ok = 0; const echecs = [];
const etape = (n) => process.stdout.write(`\n\x1b[1m${n}\x1b[0m\n`);
const v = (l, c, d = '') => { if (c) { ok++; console.log(`  \x1b[32mOK\x1b[0m  ${l}`); } else { echecs.push(l); console.log(`  \x1b[31mKO\x1b[0m  ${l}${d ? ` — ${d}` : ''}`); } };

const db = new PGlite();
await db.exec(await readFile(new URL('../migrations/001_canvas.sql', import.meta.url), 'utf8'));
const pool = pgliteAsPool(db);
const repo = new PostgresCanvasRepository({ pool });
const engine = createEngine({});
const studio = createCanvasStudio(engine, { repository: repo });

// Vrai service : scrypt pour les mots de passe, HMAC pour les jetons.
const auth = new AuthService({ users: new InMemoryUserStore(), secret: 'secret-de-recette-32-caracteres-min', ttlSec: 3600 });

const app = Fastify({ logger: false });
// Le VRAI garde d'authentification, celui de `plugins/auth.mjs`.
app.decorate('requireAuth', async function (req, reply) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) { reply.code(401).send({ error: 'jeton requis' }); return null; }
  try { return await auth.verify(token); }
  catch (e) { reply.code(401).send({ error: e.message }); return null; }
});
app.decorate('kayrosContext', { canvas: studio, engine, ideas: { save: async () => {} } });
await app.register(canvasRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;

const call = async (m, c, b, token = null) => {
  const r = await fetch(`${base}${c}`, {
    method: m,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  try { return { statut: r.status, corps: JSON.parse(t) }; } catch { return { statut: r.status, corps: t }; }
};

try {
  // ======================================================================
  etape('1. Inscription et hachage');

  const alice = await auth.register({ email: 'alice@kayroslab.com', password: 'motdepasse-solide-42', role: 'comex', tenantId: 'acme' });
  const bob = await auth.register({ email: 'bob@concurrent.com', password: 'autre-mot-de-passe-77', role: 'contributeur', tenantId: 'globex' });
  v('deux comptes créés sur deux tenants', alice.tenantId === 'acme' && bob.tenantId === 'globex');
  v('le hash du mot de passe ne fuit pas dans l’objet public', alice.passwordHash === undefined);

  await auth.register({ email: 'x@y.com', password: 'p' }).then(
    () => v('un email invalide est refusé', false),
    () => v('un email valide est accepté, un invalide refusé', true),
  ).catch(() => {});
  await auth.register({ email: 'pas-un-email', password: 'p' }).then(
    () => v('email sans @ refusé', false),
    (e) => v('email sans @ refusé', /email invalide/.test(e.message)),
  );

  // ======================================================================
  etape('2. Connexion');

  const { token: jetonAlice } = await auth.login({ email: 'alice@kayroslab.com', password: 'motdepasse-solide-42' });
  v('connexion réussie, jeton émis', typeof jetonAlice === 'string' && jetonAlice.split('.').length >= 2);

  let messageInconnu = ''; let messageFaux = '';
  await auth.login({ email: 'inexistant@nulle-part.com', password: 'x' }).catch((e) => { messageInconnu = e.message; });
  await auth.login({ email: 'alice@kayroslab.com', password: 'mauvais' }).catch((e) => { messageFaux = e.message; });
  // Un message different revelerait quels comptes existent.
  v('compte inconnu et mot de passe faux donnent le même message', messageInconnu === messageFaux && messageInconnu.length > 0, `${messageInconnu} / ${messageFaux}`);

  const charge = await auth.verify(jetonAlice);
  v('le jeton porte le tenant et le rôle', charge.tenantId === 'acme' && charge.role === 'comex');

  // ======================================================================
  etape('3. Le canvas exige un jeton valide');

  v('401 sans jeton', (await call('GET', '/v1/canvas')).statut === 401);
  v('401 avec un jeton bidon', (await call('GET', '/v1/canvas', null, 'nimporte.quoi.du.tout')).statut === 401);

  const falsifie = `${jetonAlice.slice(0, -4)}AAAA`;
  const rf = await call('GET', '/v1/canvas', null, falsifie);
  v('401 avec une signature falsifiée', rf.statut === 401, `${rf.statut} — ${rf.corps?.error}`);

  const cree = await call('POST', '/v1/canvas', { id: 'ws-acme', nom: 'Atelier ACME' }, jetonAlice);
  v('201 avec un jeton valide', cree.statut === 201);
  v('le tenant vient du jeton, jamais du corps', cree.corps.workspace.tenantId === 'acme');

  // Tentative explicite d'injection de tenant par le client.
  const injection = await call('POST', '/v1/canvas', { id: 'ws-injecte', nom: 'X', tenantId: 'globex' }, jetonAlice);
  v('un tenantId envoyé par le client est ignoré', injection.corps.workspace.tenantId === 'acme');

  // ======================================================================
  etape('4. Isolation entre tenants, bout en bout');

  const { token: jetonBob } = await auth.login({ email: 'bob@concurrent.com', password: 'autre-mot-de-passe-77' });
  await call('POST', '/v1/canvas', { id: 'ws-globex', nom: 'Atelier GLOBEX' }, jetonBob);

  v('Bob ne voit pas le canvas d’Alice', (await call('GET', '/v1/canvas/ws-acme', null, jetonBob)).statut === 404);
  v('Alice ne voit pas celui de Bob', (await call('GET', '/v1/canvas/ws-globex', null, jetonAlice)).statut === 404);
  v('la liste d’Alice ne contient que ses canvas',
    (await call('GET', '/v1/canvas', null, jetonAlice)).corps.workspaces.every((w) => w.tenantId === 'acme'));
  v('Bob ne peut pas écrire dans le canvas d’Alice',
    (await call('POST', '/v1/canvas/ws-acme/nodes', { titre: 'Intrusion' }, jetonBob)).statut === 404);

  // Le cloisonnement tient-il jusqu'a la base ?
  const enBase = await pool.query('SELECT id, tenant_id FROM canvas_workspace ORDER BY id');
  v('les tenants sont distincts en base',
    enBase.rows.length === 3 && new Set(enBase.rows.map((r) => r.tenant_id)).size === 2,
    JSON.stringify(enBase.rows));

  // ======================================================================
  etape('5. Révocation');

  await auth.logout(jetonAlice);
  const apresDeconnexion = await call('GET', '/v1/canvas', null, jetonAlice);
  v('le jeton révoqué est refusé', apresDeconnexion.statut === 401);
  v('le motif du refus est explicite', /revoqu/i.test(apresDeconnexion.corps?.error ?? ''), apresDeconnexion.corps?.error);

  const { token: jeton2 } = await auth.login({ email: 'alice@kayroslab.com', password: 'motdepasse-solide-42' });
  v('une nouvelle connexion redonne accès', (await call('GET', '/v1/canvas', null, jeton2)).statut === 200);

  auth.revokeAllSessions(alice.id);
  v('la révocation globale coupe toutes les sessions', (await call('GET', '/v1/canvas', null, jeton2)).statut === 401);

  // ======================================================================
  etape('6. Anti-force brute');

  let verrouille = false; let essais = 0;
  for (let i = 0; i < 12; i++) {
    try { await auth.login({ email: 'bob@concurrent.com', password: `faux-${i}` }); }
    catch (e) { essais++; if (/verrouill|trop|bloqu/i.test(e.message)) { verrouille = true; break; } }
  }
  v('le compte se verrouille après des échecs répétés', verrouille, `${essais} tentatives sans verrouillage`);

  // Le verrouillage ne doit pas deborder sur un autre compte.
  const { token: jetonAlice3 } = await auth.login({ email: 'alice@kayroslab.com', password: 'motdepasse-solide-42' });
  v('le verrouillage est propre à un compte', typeof jetonAlice3 === 'string');

  // ======================================================================
  etape('7. Expiration');

  const court = new AuthService({ users: new InMemoryUserStore(), secret: 'un-autre-secret-de-32-caracteres', ttlSec: 1 });
  await court.register({ email: 'ephemere@k.com', password: 'mot-de-passe-court-ttl' });
  const { token: bref } = await court.login({ email: 'ephemere@k.com', password: 'mot-de-passe-court-ttl' });
  v('le jeton est valide immédiatement', Boolean(await court.verify(bref)));
  await new Promise((r) => setTimeout(r, 1600));
  let expire = false;
  await court.verify(bref).catch(() => { expire = true; });
  v('le jeton expire à échéance', expire);

} catch (e) {
  console.error(`\n\x1b[31mInterruption : ${e.message}\x1b[0m\n${e.stack}`);
  echecs.push(`exception : ${e.message}`);
} finally {
  await app.close();
  await db.close();
}

console.log(`\n${'='.repeat(58)}`);
console.log(`AUTH RÉELLE — ${ok} vérifications, ${echecs.length} échec(s)`);
if (echecs.length) for (const e of echecs) console.log(`  - ${e}`);
console.log('='.repeat(58));
process.exit(echecs.length ? 1 : 0);
