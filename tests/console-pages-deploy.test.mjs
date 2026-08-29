import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('les accueils anglais et francais exposent la console', async () => {
  const [english, french] = await Promise.all([read('index.html'), read('index.fr.html')]);
  assert.match(english, /href="\/console\/"[^>]*>Open (?:the agent )?console/i);
  assert.match(french, /href="\/console\/"[^>]*>Ouvrir la console/i);
});

test('GitHub Pages construit et publie la console sous /console/', async () => {
  const workflow = await read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(workflow, /frontend\/console-app\/\*\*/);
  assert.match(workflow, /working-directory: frontend\/console-app/);
  assert.match(workflow, /VITE_API_BASE_URL: https:\/\/api\.kayroslab\.com/);
  assert.match(workflow, /mkdir -p deploy\/console/);
  assert.match(workflow, /backend\/web\/public\/console\/\. deploy\/console\//);
});

test('la console prefixe les routes avec la base API du build', async () => {
  const source = await read('frontend/console-app/src/api.js');
  assert.match(source, /import\.meta\.env\.VITE_API_BASE_URL/);
  assert.match(source, /fetch\(apiUrl\(path\)/);
});

test('le formulaire propose une inscription puis ouvre la console', async () => {
  const [app, api] = await Promise.all([
    read('frontend/console-app/src/App.jsx'),
    read('frontend/console-app/src/api.js'),
  ]);
  assert.match(app, /Créer un espace de découverte/);
  assert.match(app, /await api\.register\(name, email, password\)/);
  assert.match(app, /const result = await api\.login\(email, password\)/);
  assert.match(api, /register:.*request\('\/v1\/auth\/register'/);
});

test('la console v2 expose les parcours agents, reglages et decision durable', async () => {
  const [app, api, css] = await Promise.all([
    read('frontend/console-app/src/App.jsx'),
    read('frontend/console-app/src/api.js'),
    read('frontend/console-app/src/app.css'),
  ]);
  assert.match(app, /Agents/);
  assert.match(app, /Réglages/);
  assert.match(app, /Profil comportemental/);
  assert.match(app, /consentement explicite/i);
  assert.match(app, /Slack/);
  assert.match(app, /Discord/);
  assert.match(app, /Microsoft Teams/);
  assert.match(app, /Contributions individuelles/);
  assert.match(app, /Arbitrage humain/);
  assert.match(api, /\/v1\/console\/agents/);
  assert.match(api, /\/v1\/console\/connectors/);
  assert.match(api, /\/v1\/console\/threads/);
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test('la connexion expose un parcours complet de mot de passe oublie', async () => {
  const [app, api] = await Promise.all([
    read('frontend/console-app/src/App.jsx'),
    read('frontend/console-app/src/api.js'),
  ]);
  assert.match(app, /Mot de passe oublié/);
  assert.match(app, /Envoyer le lien de vérification/);
  assert.match(app, /Confirmer le mot de passe/);
  assert.match(api, /\/v1\/auth\/password\/forgot/);
  assert.match(api, /\/v1\/auth\/password\/reset/);
});
