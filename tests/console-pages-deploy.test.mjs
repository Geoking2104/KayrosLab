import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('les accueils anglais et francais exposent la console', async () => {
  const [english, french] = await Promise.all([read('index.html'), read('index.fr.html')]);
  assert.match(english, /href="\/console\/"[^>]*>Try the console/i);
  assert.match(french, /href="\/console\/"[^>]*>Essayer la console/i);
});

test('GitHub Pages construit et publie la console sous /console/', async () => {
  const workflow = await read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(workflow, /frontend\/console-app\/\*\*/);
  assert.match(workflow, /working-directory: frontend\/console-app/);
  assert.match(workflow, /VITE_API_BASE_URL: https:\/\/api\.kayroslab\.com/);
  assert.match(workflow, /mkdir -p[^\n]*deploy\/console/);
  assert.match(workflow, /backend\/web\/public\/console\/\. deploy\/console\//);
});

test('GitHub Pages ne publie plus /salon/ et rien ne le lie', async () => {
  const [workflow, english, french, notFound, vercel] = await Promise.all([
    read('.github/workflows/deploy-positionning-pages.yml'),
    read('index.html'),
    read('index.fr.html'),
    read('404.html'),
    read('vercel.json'),
  ]);
  assert.doesNotMatch(workflow, /salon/i);
  assert.doesNotMatch(english, /href="\/salon|href="#salon"|class="salon-charter"/);
  assert.doesNotMatch(french, /href="\/salon|href="#salon"|class="salon-charter"/);
  assert.doesNotMatch(notFound, /salon/i); // URL inconnue (dont /salon) : renvoi vers l'accueil
  assert.match(notFound, /location\.replace\("\/"/);
  assert.doesNotMatch(vercel, /salon/i);
  assert.match(english, /id="personify"/);
  assert.match(french, /CrystalKnows/);
});

test('la console est la revue, servie sous /console/', async () => {
  const [shell, dossiers, vite, html] = await Promise.all([
    read('frontend/console-app/src/components/console/Shell.tsx'),
    read('frontend/console-app/src/components/console/Dossiers.tsx'),
    read('frontend/console-app/vite.config.js'),
    read('frontend/console-app/index.html'),
  ]);
  assert.match(shell, /Aujourd’hui/);
  assert.match(shell, /Dossiers/);
  assert.match(shell, /Agents/);
  assert.match(shell, /Connexions/);
  assert.match(dossiers, /Trace du comité/);
  assert.match(dossiers, /Lecture seule/);
  assert.match(vite, /base: '\/console\/'/);
  assert.match(vite, /backend\/web\/public\/console/);
  assert.match(html, /KayrosLab Console/);
});

test('les anciens liens de la console restent lisibles', async () => {
  const model = await read('frontend/console-app/src/lib/console/model.ts');
  assert.match(model, /activity: "dossiers"/);
  assert.match(model, /sessions: "collectifs"/);
  assert.match(model, /integrations: "connexions"/);
  const shell = await read('frontend/console-app/src/components/console/Shell.tsx');
  assert.match(shell, /split\("\?"\)/);
  assert.match(shell, /params\.get\("thread"\)/);
});
