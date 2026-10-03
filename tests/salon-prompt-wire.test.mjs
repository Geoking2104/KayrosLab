import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lot 1 : le prompt envoyé à /v1/demo/chat n'est plus tronqué à 280 caractères,
// et son bornage préserve le contrat PRISE:/REPLIQUE: (retours à la ligne).
const code = readFileSync(new URL('../backend/web/public/salon/salon-engine.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const circleUi = readFileSync(new URL('../backend/web/public/salon/circle-ui.js', import.meta.url), 'utf8');

const voltaire = {
  id: 'voltaire', name: 'Voltaire', nameEn: 'Voltaire', kind: 'philosophe', method: 'auto',
  blurb: "L'ironie contre les dogmes : optimisme naïf mis à l'épreuve du réel, tolérance, lucidité.",
  works: [{ title: "Candide, ou l'optimisme" }, { title: 'Micromégas' }],
};

test('wire : plus de clip(sys, 280) dans circle-ui.js (lot 1)', () => {
  assert.ok(!circleUi.includes('clip(sys, 280)'), 'l’ancien clip de 280 caractères a disparu');
  assert.ok(circleUi.includes('clipRaw'), 'la nouvelle borne préserve les retours à la ligne');
});

test('wire : floorPrompt borné (system ≤ 3800, user ≤ 5800) mais non tronqué à 280', () => {
  const question = "Que reste-t-il de la liberté une fois qu'on a tout expliqué ?";
  const passages = [
    { work: "Candide, ou l'optimisme", text: 'Les rois ne se maintiennent que par la flatterie et la guerre.', sentence: 'Les rois ne se maintiennent que par la flatterie et la guerre.', weak: false },
    { work: 'Micromégas', text: 'La grandeur des corps ne fait pas la grandeur des esprits.', sentence: 'La grandeur des corps ne fait pas la grandeur des esprits.', weak: false },
  ];
  const history = Array.from({ length: 6 }, (_, i) => ({
    name: 'Convive ' + i,
    prise: 'prise ' + i + ' ' + 'p'.repeat(200),
    text: 'Tour ' + i + ' — ' + 'phrase complète. '.repeat(60),
  }));
  const fp = E.floorPrompt({ author: voltaire, question, scope: E.scope(question), passages, history, self: [], role: 'lecteur', lang: 'fr' });
  assert.ok(fp.system.length > 280, 'system dépasse 280 (mémoire/persona conservés) : ' + fp.system.length);
  assert.ok(fp.system.length <= 3800, 'system ≤ 3800 : ' + fp.system.length);
  assert.ok(fp.user.length <= 5800, 'user ≤ 5800 : ' + fp.user.length);
  assert.match(fp.user, /Passages/);
  assert.match(fp.user, /Fil récent/);
  assert.match(fp.system, /^PRISE:/m, 'PRISE: est en début de ligne');
  assert.match(fp.user, /« Candide, ou l'optimisme »/);
});
