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

test('GitHub Pages publie Salon sous /salon/ depuis le pied de page', async () => {
  const [workflow, english, french, foyer] = await Promise.all([
    read('.github/workflows/deploy-positionning-pages.yml'),
    read('index.html'),
    read('index.fr.html'),
    read('backend/web/public/salon/index.html'),
  ]);
  assert.match(workflow, /backend\/web\/public\/salon\/\*\*/);
  assert.match(workflow, /mkdir -p deploy\/salon/);
  assert.match(workflow, /backend\/web\/public\/salon\/\. deploy\/salon\//);
  assert.match(english, /href="\/salon\/">Salon</);
  assert.match(french, /href="\/salon\/">Salon</);
  assert.match(foyer, /Un cercle est une table/);
  assert.match(foyer, /@voltaire/);
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
  assert.match(app, /Continuer avec SSO/);
  assert.match(api, /\/v1\/auth\/sso\/callback/);
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

test('EF-26 / EF-28 : la console annonce le rôle requis avant toute saisie et propose la simulation de personnalité', async () => {
  const app = await read('frontend/console-app/src/App.jsx');
  assert.match(app, /const MANAGER_ROLES = \['comex', 'admin'\]/);
  assert.match(app, /Réservé aux rôles comex ou admin/);
  // Boutons de création d'agents grisés pour un contributeur (pas de formulaire puis 403).
  for (const label of ['Agent hybride', 'Agent impersonator', 'Équipe d\'impersonators']) {
    assert.match(app, new RegExp(`disabled=\\{!manager\\} title=\\{locked\\} onClick=\\{\\(\\) => set\\w+\\(true\\)\\}>${label}<`));
  }
  // Arbitrage grisé hors comex/admin.
  assert.match(app, /canArbitrate=\{canManage\(data\.user\)\}/);
  assert.match(app, /disabled=\{!canArbitrate\}[^>]*onClick=\{\(\) => arbitrate\('accept_consensus'\)\}/);
  // Option de simulation de personnalité en session et dans l'équipe d'impersonators.
  assert.match(app, /personality_simulation_enabled: personality/);
  assert.match(app, /personality_simulation_enabled: form\.personality_simulation_enabled/);
});
