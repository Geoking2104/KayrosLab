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
