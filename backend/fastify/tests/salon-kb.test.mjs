import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp, bearer, registerComex } from './test-helpers.mjs';
import { createSalonKb, buildKbQuery, relevance } from '../lib/salon-kb.mjs';

const S = [
  "La liberté n'est pas de faire ce qu'on veut, mais de vouloir ce que l'on fait vraiment.",
  "On ne force personne à être libre sans lui ôter la liberté qu'il croyait tenir.",
  "Le pouvoir n'est légitime que lorsqu'il peut être contesté sans violence.",
  "Une coutume n'est jamais une preuve : elle prouve qu'on a cessé de penser.",
  "La guerre est un art trop sérieux pour être laissé aux seuls généraux.",
  "Chaque peuple a les maximes qu'il mérite, et parfois celles qu'il redoute.",
];

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'salon-kb-'));
  await mkdir(join(dir, 'kb'), { recursive: true });
  const pack = {
    authorId: 'demo',
    kbVersion: 'demo@test',
    source: 'test',
    passages: S.map((s, i) => ({ id: `demo.p${String(i + 1).padStart(4, '0')}`, w: 'Essai', s, src: { work: 'Essai' } })),
    formulas: [
      { id: 'demo.f.v0001', kind: 'verbatim', text: S[0], work: 'Essai' },
      { id: 'demo.f.v0002', kind: 'verbatim', text: S[2], work: 'Essai' },
    ],
    stats: { sentences: S.length, formulas: 2 },
  };
  await writeFile(join(dir, 'kb', 'demo.json'), JSON.stringify(pack), 'utf8');
  await writeFile(join(dir, 'kb-manifest.json'), JSON.stringify({
    generatedAt: 'test', totals: { authors: 1, sentences: S.length, formulas: 2 },
    authors: { demo: { kbVersion: 'demo@test', sentences: S.length, formulas: 2 } },
  }), 'utf8');
  return dir;
}

describe('Salon × OpenKB : pont mémoire (lib)', () => {
  it('construit une requête conditionnée : question, prise, acte, tweet', () => {
    const q = buildKbQuery({
      question: 'Que reste-t-il de la liberté ?',
      context: {
        turns: [{ name: 'rousseau', prise: 'la liberté se perd dans la coutume' }],
        act: 'objection', toName: 'voltaire', tweet: 'Un post sur la liberté.',
      },
    });
    assert.match(q, /Question de table.*liberté/);
    assert.match(q, /rousseau.*coutume/);
    assert.match(q, /objection.*voltaire/);
    assert.match(q, /Gazette.*liberté/);
  });

  it('retrieval : classe selon la question, marque weak, déterministe', async () => {
    const dir = await fixtureDir();
    const kb = createSalonKb({ packDir: dir });
    const one = await kb.query({ authorId: 'demo', question: "Que reste-t-il de la liberté ?" });
    assert.equal(one.ok, true);
    assert.equal(one.mode, 'retrieval');
    assert.ok(one.passages.length >= 2);
    assert.match(one.passages[0].sentence, /libert/i);
    const two = await kb.query({ authorId: 'demo', question: "Que reste-t-il de la liberté ?" });
    assert.deepEqual(one.passages, two.passages);
    assert.equal(two.cached, true);
  });

  it('answer : synthèse OpenKB via fetch injecté + cache', async () => {
    const dir = await fixtureDir();
    let calls = 0;
    const kb = createSalonKb({
      packDir: dir,
      fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ answer: 'synthèse ancrée' }) }; },
    });
    const one = await kb.query({ authorId: 'demo', question: 'Question A', mode: 'answer' });
    assert.equal(one.ok, true);
    assert.equal(one.engine, 'openkb');
    assert.equal(one.synthesis, 'synthèse ancrée');
    assert.equal(calls, 1);
    const again = await kb.query({ authorId: 'demo', question: 'Question A', mode: 'answer' });
    assert.equal(again.cached, true);
    assert.equal(calls, 1, 'le cache évite un second appel');
    await kb.query({ authorId: 'demo', question: 'Question B', mode: 'answer' });
    assert.equal(calls, 2);
  });

  it('disjoncteur : ouvre après N échecs, se referme après le délai', async () => {
    const dir = await fixtureDir();
    let open = true;
    const kb = createSalonKb({
      packDir: dir,
      breakerThreshold: 3,
      breakerCooldownMs: 10,
      fetchImpl: async () => { throw new Error('boom'); },
    });
    for (let i = 0; i < 3; i += 1) {
      const r = await kb.query({ authorId: 'demo', question: `Q${i}`, mode: 'answer' });
      assert.equal(r.ok, false);
      assert.equal(r.degraded, 'unreachable');
    }
    const opened = await kb.query({ authorId: 'demo', question: 'Q4', mode: 'answer' });
    assert.equal(opened.degraded, 'circuit_open');
    open = false;
    await new Promise((r) => setTimeout(r, 15));
    const closed = await kb.query({ authorId: 'demo', question: 'Q5', mode: 'answer' });
    assert.equal(closed.degraded, 'unreachable', 'le disjoncteur se referme après le délai');
  });

  it('auteur inconnu : dégradation explicite, jamais de fuite inter-auteurs', async () => {
    const dir = await fixtureDir();
    const kb = createSalonKb({ packDir: dir });
    const out = await kb.query({ authorId: 'inconnu', question: 'test' });
    assert.equal(out.ok, false);
    assert.equal(out.degraded, 'unknown_author');
  });

  it('relevance reste stable (contrôle lexical simple)', () => {
    const a = relevance("liberté", S[0]);
    const b = relevance("liberté", S[4]);
    assert.ok(a > b, `attendu ${a} > ${b}`);
    assert.equal(a, relevance("liberté", S[0]));
  });
});

describe('Salon × OpenKB : routes /v1/salon/kb', () => {
  let app, ctx, dir, oldEnv, tok;
  beforeEach(async () => {
    dir = await fixtureDir();
    oldEnv = process.env.SALON_KB_PACK_DIR;
    process.env.SALON_KB_PACK_DIR = dir;
    const built = await buildTestApp();
    app = built.app;
    ctx = built.ctx;
    await registerComex(ctx, { email: 'kb@test.local', password: 'secret1234', name: 'KB' });
    tok = await bearer(ctx, 'kb@test.local', 'secret1234');
  });
  afterEach(async () => {
    if (app) await app.close();
    if (oldEnv === undefined) delete process.env.SALON_KB_PACK_DIR;
    else process.env.SALON_KB_PACK_DIR = oldEnv;
  });

  it('exige un jeton', async () => {
    const naked = await app.inject({ method: 'GET', url: '/v1/salon/kb/manifest' });
    assert.equal(naked.statusCode, 401);
  });

  it('rend le manifeste et des passages ancrés', async () => {
    const man = await app.inject({ method: 'GET', url: '/v1/salon/kb/manifest', headers: { authorization: `Bearer ${tok}` } });
    assert.equal(man.statusCode, 200, man.body);
    assert.equal(man.json().manifest.totals.sentences, S.length);

    const q = await app.inject({
      method: 'POST', url: '/v1/salon/kb/query',
      headers: { authorization: `Bearer ${tok}` },
      payload: { authorId: 'demo', question: "Que reste-t-il de la liberté ?", context: { act: 'reponse' }, k: 2 },
    });
    assert.equal(q.statusCode, 200, q.body);
    const body = q.json();
    assert.equal(body.ok, true);
    assert.ok(body.passages.length <= 2 && body.passages.length >= 1);
    assert.ok(body.kbVersion);
  });

  it('valide les entrées et signale les auteurs inconnus', async () => {
    const bad = await app.inject({ method: 'POST', url: '/v1/salon/kb/query', headers: { authorization: `Bearer ${tok}` }, payload: { authorId: 'demo' } });
    assert.equal(bad.statusCode, 400);
    const unknown = await app.inject({ method: 'POST', url: '/v1/salon/kb/query', headers: { authorization: `Bearer ${tok}` }, payload: { authorId: 'zzz', question: 'test' } });
    assert.equal(unknown.statusCode, 404);
    const status = await app.inject({ method: 'GET', url: '/v1/salon/kb/status/zzz', headers: { authorization: `Bearer ${tok}` } });
    assert.equal(status.statusCode, 404);
    const okStatus = await app.inject({ method: 'GET', url: '/v1/salon/kb/status/demo', headers: { authorization: `Bearer ${tok}` } });
    assert.equal(okStatus.statusCode, 200);
    assert.equal(okStatus.json().status.sentences, S.length);
  });
});
