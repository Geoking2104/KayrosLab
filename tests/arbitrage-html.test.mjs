// KayrosLab -- la page d'arbitrage.
//
// Les routes de reprise existaient depuis un moment, mais arbitrer passait
// par curl : le cycle ne servait a personne. Cette page est le maillon
// manquant, et ces tests tiennent ce qui compte -- l'echappement, l'absence
// d'identifiants generes dans du JavaScript inline, et la conformite au
// contrat des routes.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PAGE = new URL('../arbitrage.html', import.meta.url);

async function loadPage() {
  const html = await readFile(PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  return { html, scripts };
}

test('le JavaScript inline est syntaxiquement valide', async () => {
  const { scripts } = await loadPage();
  assert.ok(scripts.length > 0, 'au moins un script inline');
  for (const source of scripts) {
    assert.doesNotThrow(() => new Function(source), 'un script inline doit parser');
  }
});

test('aucun identifiant genere n’entre dans du JavaScript inline', async () => {
  const { html } = await loadPage();
  // Piege deja rencontre dans ce depot : un runId injecte dans onclick="..."
  // casse la page des qu'il contient une apostrophe, et ouvre une injection.
  assert.equal(/on[a-z]+\s*=\s*"[^"]*\$\{/.test(html), false, 'pas de template dans un handler inline');
  assert.equal(/onclick=/.test(html), false, 'les handlers passent par addEventListener');
  assert.match(html, /addEventListener\('click'/, 'la delegation est cablee');
  assert.match(html, /data-run="/, 'le runId voyage par data-attribut');
  assert.match(html, /dataset\.run/, 'et est relu depuis le dataset');
});

test('tout ce qui vient de l’API est echappe avant insertion', async () => {
  const { scripts } = await loadPage();
  const source = scripts.join('\n');
  assert.match(source, /function esc\(/, 'un echappeur existe');
  for (const char of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    assert.ok(source.includes(char), `esc() doit couvrir ${char}`);
  }
  // Les champs libres (motifs, commentaires de revue, identifiants) passent
  // tous par esc() : aucune interpolation nue dans innerHTML.
  for (const field of ['run.runId', 'run.ideaId', 'gate.nodeId', 'final.message']) {
    assert.ok(source.includes(`esc(${field})`), `${field} doit etre echappe`);
  }
});

test('la page parle exactement le contrat des routes de reprise', async () => {
  const { scripts } = await loadPage();
  const source = scripts.join('\n');
  assert.match(source, /'\/v1\/runs\/suspended'/, 'liste des runs suspendus');
  assert.match(source, /\/v1\/runs\/' \+ encodeURIComponent\(runId\)/, 'detail par runId encode');
  assert.match(source, /\/resume'/, 'reprise');
  assert.match(source, /stream: false/, 'la page consomme la reponse agregee, pas le SSE');
  assert.match(source, /method: 'POST'/);
});

test('les trois decisions du graphe unifie sont proposees', async () => {
  const { html } = await loadPage();
  for (const decision of ['approve', 'revise', 'veto']) {
    assert.ok(html.includes(`data-decision="${decision}"`), `decision ${decision} exposee`);
  }
  // Le vocabulaire doit dire ce que la decision fait, pas son nom technique.
  assert.match(html, /produire le livrable/i);
  assert.match(html, /ré-attaquer l'idée/i);
});

test('un motif est exige pour une revision ou un veto', async () => {
  const { scripts } = await loadPage();
  const source = scripts.join('\n');
  // Un veto sans motif est ingerable a l'audit : la page le refuse avant
  // d'appeler l'API.
  assert.match(source, /decision === 'veto' \|\| decision === 'revise'/);
  assert.match(source, /motif est requis/i);
});

test('la page rappelle qu’un veto ne coute aucune production', async () => {
  const { html } = await loadPage();
  assert.match(html, /veto ne coûte aucune production/i);
});

test('un run qui se re-suspend est signale plutot que presente comme fini', async () => {
  const { scripts } = await loadPage();
  const source = scripts.join('\n');
  assert.match(source, /pending_review/, 'le statut suspendu est traite');
  assert.match(source, /suspendu/i);
});

test('la page est reliee au reste de la navigation', async () => {
  const { html } = await loadPage();
  assert.match(html, /href="\.\/portfolio-board\.html"/);
  assert.match(html, /href="\.\/cycle-timeline\.html"/);
  assert.match(html, /<link rel="stylesheet" href="\.\/tokens\.css">/, 'meme charte que les autres pages');
  assert.match(html, /<html lang="fr">/);
});

test('la page est atteignable depuis les autres vues', async () => {
  // Une page qu'on ne peut pas trouver ne sert pas davantage qu'une page
  // qui n'existe pas.
  for (const from of ['../portfolio-board.html', '../cycle-timeline.html']) {
    const html = await readFile(new URL(from, import.meta.url), 'utf8');
    assert.match(html, /href="\.\/arbitrage\.html"/, `${from} doit pointer vers l'arbitrage`);
  }
});

test('la page est publiee par le workflow de deploiement', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/deploy-positionning-pages.yml', import.meta.url), 'utf8',
  );
  // Une page qui n'est pas copiee n'existe pas pour l'utilisateur.
  assert.match(workflow, /arbitrage\.html/, 'arbitrage.html doit etre copiee dans deploy/');
});
