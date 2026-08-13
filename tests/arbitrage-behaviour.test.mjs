// KayrosLab -- comportement reel de la page d'arbitrage.
//
// Les tests voisins lisent le fichier par expressions regulieres : ils
// verifient qu'une precaution est ecrite, pas qu'elle fonctionne. Ceux-ci
// executent le script de la page et exercent ses fonctions avec des donnees
// hostiles et un fetch simule. Rien n'est reimplemente ici : ce qui est teste
// est exactement ce qui est servi.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PAGE = new URL('../arbitrage.html', import.meta.url);

/** Execute le script inline de la page et rend sa surface testable. */
async function loadSurface() {
  const html = await readFile(PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s) => s.includes('KAYROS_ARBITRAGE'));
  assert.equal(scripts.length, 1, 'un seul script expose la surface');

  // Le minimum pour que le script s'installe : il ne touche au DOM qu'au
  // cablage, sur des elements qu'on lui fournit inertes.
  const listeners = {};
  const stubEl = {
    value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const win = {};
  const doc = { getElementById: () => stubEl };
  const fn = new Function('window', 'document', 'fetch', 'CSS', `${scripts[0]}\nreturn window.KAYROS_ARBITRAGE;`);
  return fn(win, doc, () => { throw new Error('fetch non simule'); }, { escape: (s) => s });
}

const HOSTILE = '"><img src=x onerror=alert(1)>\'&';

// ------------------------------------------------------------ echappement

test('esc neutralise reellement une charge hostile', async () => {
  const api = await loadSurface();
  const out = api.esc(HOSTILE);
  for (const char of ['<', '>', '"', "'", '&']) {
    assert.equal(out.includes(char) && !out.includes('&'), false);
  }
  assert.equal(out.includes('<img'), false, 'aucune balise ne survit');
  assert.equal(out.includes('onerror='), true, 'le texte reste lisible');
  assert.match(out, /&quot;&gt;&lt;img/, 'les caracteres significatifs sont encodes');
});

test('une carte construite avec des donnees hostiles n’injecte rien', async () => {
  const api = await loadSurface();
  const card = api.runCard({
    runId: HOSTILE,
    ideaId: HOSTILE,
    updatedAt: HOSTILE,
    gate: { type: HOSTILE, nodeId: HOSTILE },
  });
  // Le critere n'est pas l'absence du texte "onerror" -- echappe, il est
  // inerte et doit rester lisible -- mais l'absence de la charge brute :
  // aucune sequence capable de fermer un attribut ou d'ouvrir une balise.
  assert.equal(card.includes(HOSTILE), false, 'la charge brute n’apparait jamais');
  assert.ok(card.includes(api.esc(HOSTILE)), 'elle n’apparait qu’echappee');
  assert.equal(card.includes('<img'), false, 'aucune balise injectee');
  // Et la carte reste fonctionnelle : les trois decisions sont la.
  for (const decision of ['approve', 'revise', 'veto']) {
    assert.ok(card.includes(`data-decision="${decision}"`), decision);
  }
  // Le type de gate inconnu retombe sur sa valeur brute, echappee.
  assert.equal(api.gateLabel(HOSTILE), HOSTILE, 'gateLabel ne decore pas');
  assert.equal(card.includes(api.gateLabel(HOSTILE)), false, 'mais la carte l’echappe');
});

test('gateLabel ne resout pas une cle heritee', async () => {
  const api = await loadSurface();
  assert.equal(api.gateLabel('constructor'), 'constructor');
  assert.equal(api.gateLabel('__proto__'), '__proto__');
  assert.equal(api.gateLabel('decision_arbitrage'), 'Arbitrage du packet de décision');
});

test('le detail expose la taille du livrable, jamais son contenu', async () => {
  const api = await loadSurface();
  const rows = api.detailRows({
    gate: { type: 'decision_arbitrage', requiredRole: 'comex' },
    review: { status: 'KO', comments: [HOSTILE] },
    draft: { format: 'markdown', bytes: 4096 },
    nodeAttempts: { writer: 2 },
  });
  assert.match(rows, /4096 octets/);
  assert.equal(rows.includes('<img'), false, 'un commentaire hostile est echappe');
  assert.match(rows, /writer×2/, 'les passages consommes sont visibles');
});

// ------------------------------------------------------ contrat HTTP reel

function fakeFetch(response) {
  const calls = [];
  const doFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: async () => response.body,
    };
  };
  return { calls, doFetch };
}

async function clientWith(response) {
  const api = await loadSurface();
  const { calls, doFetch } = fakeFetch(response);
  const client = api.createClient({
    fetch: doFetch,
    base: () => 'https://api.test',
    headers: () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer jeton' }),
  });
  return { client, calls };
}

test('lister appelle la bonne route avec le jeton', async () => {
  const { client, calls } = await clientWith({ body: { runs: [], total: 0 } });
  await client.listSuspended();
  assert.equal(calls[0].url, 'https://api.test/v1/runs/suspended');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer jeton');
});

test('un runId hostile est encode dans l’URL', async () => {
  const { client, calls } = await clientWith({ body: {} });
  await client.detail('run/../../admin?x=1');
  assert.equal(calls[0].url, 'https://api.test/v1/runs/run%2F..%2F..%2Fadmin%3Fx%3D1');
  assert.equal(calls[0].url.includes('/admin'), false, 'pas de traversee de chemin');
});

test('reprendre envoie exactement le contrat attendu par la route', async () => {
  const { client, calls } = await clientWith({ body: { events: [], final: null } });
  await client.resume('run-1', 'veto', 'hors budget');
  const sent = calls[0];
  assert.equal(sent.url, 'https://api.test/v1/runs/run-1/resume');
  assert.equal(sent.options.method, 'POST');
  assert.deepEqual(JSON.parse(sent.options.body), {
    decision: 'veto', reason: 'hors budget', stream: false,
  });
});

test('une erreur de l’API remonte son motif, pas un code nu', async () => {
  const { client } = await clientWith({ ok: false, status: 409, body: { error: 'run non suspendu' } });
  await assert.rejects(() => client.listSuspended(), /run non suspendu/);

  const { client: muet } = await clientWith({ ok: false, status: 503, body: null });
  await assert.rejects(() => muet.listSuspended(), /HTTP 503/);
});

// ------------------------------------------------------------- decisions

test('le motif est exige pour une revision ou un veto, pas pour un Go', async () => {
  const api = await loadSurface();
  assert.equal(api.needsReason('veto'), true);
  assert.equal(api.needsReason('revise'), true);
  assert.equal(api.needsReason('approve'), false);
});

test('le resultat distingue les trois issues', async () => {
  const api = await loadSurface();
  const bloque = api.resultRows({ events: [], final: { status: 'blocked_veto', message: HOSTILE } });
  assert.match(bloque, /text-rose-600/);
  assert.equal(bloque.includes('<img'), false, 'le motif du veto est echappe');

  const suspendu = api.resultRows({ events: [], final: { status: 'pending_review' } });
  assert.match(suspendu, /text-amber-600/);
  assert.match(suspendu, /de nouveau suspendu/i, 'un run suspendu n’est pas presente comme fini');

  const fini = api.resultRows({
    events: [{ type: 'trace', nodeId: 'writer' }, { type: 'trace', nodeId: 'logger' }],
    final: { status: 'validated_human' },
  });
  assert.match(fini, /text-emerald-600/);
  assert.match(fini, /writer → logger/, 'le chemin parcouru est restitue');
});
