import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DEMO_PATH = new URL('../kayroslab-complete-with-ai-agents.html', import.meta.url);

async function loadDemo() {
  const html = await readFile(DEMO_PATH, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  return { html, scripts };
}

function functionSource(source, name, { required = true } = {}) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    if (!required) return '';
    assert.fail(`expected inline function ${name}()`);
  }
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated inline function ${name}()`);
}

test('the published demo inline JavaScript is syntactically valid', async () => {
  const { scripts } = await loadDemo();
  assert.ok(scripts.length > 0, 'expected at least one inline script');

  for (const source of scripts) {
    assert.doesNotThrow(
      () => new Function(source),
      'an inline script must parse so HTML onclick handlers can resolve'
    );
  }
});

test('the Explorer les possibles CTA is wired to its handler', async () => {
  const { html, scripts } = await loadDemo();
  assert.match(
    html,
    /id="demo-start-btn"[^>]*onclick="startIdeaExploration\(\)"/,
    'the CTA must call startIdeaExploration()'
  );
  assert.match(
    scripts.join('\n'),
    /function\s+startIdeaExploration\s*\(/,
    'startIdeaExploration() must be defined by a valid inline script'
  );
});

test('Sigma uses its browser bundle rather than the CommonJS entry point', async () => {
  const { html } = await loadDemo();
  assert.match(
    html,
    /sigma@2\.4\.0\/build\/sigma\.min\.js/,
    'the browser must load Sigma from its build/ bundle'
  );
});

test('Build recovers scenario JSON containing unescaped quotes in generated names', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const helpers = [
    functionSource(source, 'stripJsonFences'),
    functionSource(source, 'tryParseJson'),
    functionSource(source, 'repairMalformedJson', { required: false }),
    functionSource(source, 'extractJsonValue'),
    functionSource(source, 'normalizeScenariosMap')
  ].join('\n');
  const normalizeScenariosMap = new Function(`${helpers}; return normalizeScenariosMap;`)();
  const malformed = '{"scenarios":[{"id":"s1","name":"Plateforme IoT "SmartMaintenance" pour PME","thesis":"Pilote mesurable","feasibility":8,"horizon":"3-5 ans","falsifiable_hypothesis":"ROI sous 12 mois","first_test":"10 PME"},{"id":"s2","name":"Alliance "Predictive4EU" industrielle","thesis":"Standard commun","feasibility":6,"horizon":"5-7 ans","falsifiable_hypothesis":"3 partenaires signent","first_test":"Atelier"}]}';

  const map = normalizeScenariosMap(malformed);

  assert.equal(map.scenarios.length, 2);
  assert.equal(map.scenarios[0].name, 'Plateforme IoT "SmartMaintenance" pour PME');
  assert.equal(map.scenarios[1].name, 'Alliance "Predictive4EU" industrielle');

  const punctuated = '{"scenarios":[{"id":"s1","name":"Platform "Alpha", targeting SMEs","thesis":"Pilot","feasibility":8,"horizon":"3 years","falsifiable_hypothesis":"ROI","first_test":"10 SMEs"},{"id":"s2","name":"Alternative","thesis":"Control","feasibility":6,"horizon":"4 years","falsifiable_hypothesis":"Adoption","first_test":"Workshop"}]}';
  const punctuatedMap = normalizeScenariosMap(punctuated);
  assert.equal(punctuatedMap.scenarios[0].name, 'Platform "Alpha", targeting SMEs');
});

test('Build replaces generated text with an interactive editable scenario canvas', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const buildSource = functionSource(source, 'buildScenariosPanel');
  const buildScenariosPanel = new Function(
    'escapeHtml',
    't',
    `${buildSource}; return buildScenariosPanel;`
  )(
    (value) => String(value),
    (key) => key
  );
  const panel = buildScenariosPanel({ scenarios: [
    { id: 's1', name: 'Option A', thesis: 'Thèse A', feasibility: 8, horizon: '3 ans', falsifiable_hypothesis: 'Hypothèse A', first_test: 'Test A' },
    { id: 's2', name: 'Option B', thesis: 'Thèse B', feasibility: 6, horizon: '5 ans', falsifiable_hypothesis: 'Hypothèse B', first_test: 'Test B' }
  ] }, 'fr');

  assert.match(panel, /data-scenario-id="s1"/);
  assert.match(panel, /onclick="selectScenario\('s1'\)"/);
  assert.match(panel, /aria-pressed="true"/);
  assert.doesNotMatch(panel, /role="tab(?:list|panel)?"/, 'scenario selectors use ordinary pressed buttons, not an incomplete ARIA tab pattern');
  assert.match(panel, /data-scenario-editor/);
  assert.match(panel, /oninput="updateScenarioField\('s1','thesis',this\.value\)"/);
  assert.match(
    source,
    /contentHtml\s*=\s*buildScenariosPanel\(smap,\s*lang\)/,
    'structured Build output must replace raw generated text rather than append to it'
  );
});

test('approving Build snapshots the selected scenario and every edited assumption', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const demoState = {
    currentStep: 2,
    currentOutput: '{"scenarios":[{"name":"stale generated value"}]}',
    currentOutputGeneratedAt: '2026-08-11T10:00:00.000Z',
    ki: 6,
    history: [],
    scenariosMap: {
      selectedScenarioId: 's2',
      scenarios: [
        { id: 's1', name: 'Option A', thesis: 'Edited A', feasibility: 7, horizon: '2 years', falsifiable_hypothesis: 'Hypothesis A', first_test: 'Test A' },
        { id: 's2', name: 'Chosen <safe>', thesis: 'Edited thesis', feasibility: 9, horizon: '6 months', falsifiable_hypothesis: 'Edited hypothesis', first_test: 'Edited test' }
      ]
    }
  };
  const saveStepResult = new Function(
    'demoState', 'stepMeta', 'stepLabel', 'agentLabel', 'cycleLanguage', 'stripHtml', 'document',
    `${functionSource(source, 'saveStepResult')}; return saveStepResult;`
  )(
    demoState, [{}, {}, {}], () => 'Build', () => 'Scenario Generator', () => 'en',
    () => '', { getElementById: () => ({ innerHTML: '' }) }
  );

  saveStepResult('approved', '', 5.5, 6);

  const saved = demoState.history[0];
  assert.deepEqual(JSON.parse(saved.output), demoState.scenariosMap);
  assert.deepEqual(saved.scenariosMap, demoState.scenariosMap);
  assert.notStrictEqual(saved.scenariosMap, demoState.scenariosMap, 'history must keep a snapshot, not mutable UI state');
});

test('downstream prompts receive the selected scenario and edited assumptions as JSON', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const scenariosMap = {
    selectedScenarioId: 's2',
    scenarios: [
      { id: 's1', name: 'Option A', thesis: 'Thesis A', feasibility: 7, horizon: '2 years', falsifiable_hypothesis: 'Hypothesis A', first_test: 'Test A' },
      { id: 's2', name: 'Chosen option', thesis: 'Edited thesis', feasibility: 9, horizon: '6 months', falsifiable_hypothesis: 'Edited hypothesis', first_test: 'Edited test' }
    ]
  };
  const promptState = { currentStep: 3, scenariosMap, selectedOntologyGapIds: [], ontologyMap: null };
  const buildUserPrompt = new Function(
    'demoState', 't',
    `${functionSource(source, 'buildUserPrompt')}; return buildUserPrompt;`
  )(
    promptState,
    (key) => key
  );

  const prompt = buildUserPrompt('Idea', {}, [], 'en');

  assert.match(prompt, /Scenario context selected and edited during Build/);
  assert.ok(prompt.includes(JSON.stringify(scenariosMap)), 'the context must remain machine-readable JSON');
  promptState.currentStep = 2;
  assert.ok(
    !buildUserPrompt('Idea', {}, [], 'en').includes(JSON.stringify(scenariosMap)),
    'Build itself must not receive stale scenario context; only downstream agents should'
  );
});

test('editing a scenario name or thesis updates its visible card safely and immediately', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const scenario = { id: 's1', name: 'Old name', thesis: 'Old thesis', feasibility: 5 };
  const visibleName = { textContent: '' };
  const visibleThesis = { textContent: '' };
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-scenario-name="s1"]') return [visibleName];
      if (selector === '[data-scenario-thesis="s1"]') return [visibleThesis];
      return [];
    }
  };
  const updateScenarioField = new Function(
    'demoState', 'document',
    `${functionSource(source, 'updateScenarioField')}; return updateScenarioField;`
  )({ scenariosMap: { selectedScenarioId: 's1', scenarios: [scenario] } }, document);

  updateScenarioField('s1', 'name', '<img src=x onerror=alert(1)>');
  updateScenarioField('s1', 'thesis', '<script>alert(1)</script>');

  assert.equal(visibleName.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(visibleThesis.textContent, '<script>alert(1)</script>');
  assert.equal(scenario.name, visibleName.textContent);
  assert.equal(scenario.thesis, visibleThesis.textContent);
});

test('Build clears stale scenario state before requesting a fresh generation', async () => {
  const { scripts } = await loadDemo();
  const runStep = functionSource(scripts.join('\n'), 'runStep');
  const resetAt = runStep.indexOf('if (stepIdx === 2) demoState.scenariosMap = null;');
  const requestAt = runStep.indexOf('callMistralViaProxy');

  assert.ok(resetAt >= 0, 'Build must clear any canvas left by an earlier cycle or failed rerun');
  assert.ok(resetAt < requestAt, 'stale state must be cleared before the generation request can fail');
});
