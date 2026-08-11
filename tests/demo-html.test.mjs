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
  assert.match(panel, /onclick="selectScenario\(this\.dataset\.scenarioId\)"/);
  assert.match(panel, /aria-pressed="true"/);
  assert.doesNotMatch(panel, /role="tab(?:list|panel)?"/, 'scenario selectors use ordinary pressed buttons, not an incomplete ARIA tab pattern');
  assert.match(panel, /data-scenario-editor/);
  assert.match(panel, /data-scenario-field="thesis"/);
  assert.match(panel, /oninput="updateScenarioField\(this\.dataset\.scenarioId,this\.dataset\.scenarioField,this\.value\)"/);
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
  assert.equal(saved.output, 'Chosen <safe> — Edited thesis');
  assert.deepEqual(JSON.parse(saved.rawOutput), demoState.scenariosMap);
  assert.deepEqual(saved.scenariosMap, demoState.scenariosMap);
  assert.notStrictEqual(saved.scenariosMap, demoState.scenariosMap, 'history must keep a snapshot, not mutable UI state');
});

test('history uses the panel readable text instead of concatenated UI or raw JSON', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const demoState = {
    currentStep: 3, currentOutput: '{"entities":["Platform"],"relations":["Supports teams"]}',
    currentOutputGeneratedAt: '2026-08-11T00:00:00.000Z', scenariosMap: null,
    stepChoiceMaps: { 3: { selectedIds: [], combinedText: '', readableText: 'Entities: Platform\nRelationships: Supports teams' } },
    history: [], ki: 6, currentExecutionMode: 'test'
  };
  const save = new Function(
    'demoState', 'document', 'cycleLanguage', 'stepLabel', 'agentLabel', 'stripHtml', 'stepMeta',
    `${functionSource(source, 'saveStepResult')}; return saveStepResult;`
  )(demoState, { getElementById: () => ({ innerHTML: '<p>Hint</p><button>Combine</button><p>Platform</p>' }) }, () => 'en', () => 'Position', () => 'Agent', () => 'HintCombinePlatform', [{}, {}, {}, {}]);

  save('approved', '', 6, 6.2);

  assert.equal(demoState.history[0].output, 'Entities: Platform\nRelationships: Supports teams');
  assert.match(demoState.history[0].rawOutput, /^\{/);
  assert.doesNotMatch(demoState.history[0].output, /\{|Combine|Hint/);
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
  const visibleName = { textContent: '', getAttribute: () => 's1' };
  const visibleThesis = { textContent: '', getAttribute: () => 's1' };
  const visibleChoice = { choiceText: '', getAttribute: () => 's1', hasAttribute: (name) => name === 'data-step-choice', setAttribute(name, value) { if (name === 'data-choice-text') this.choiceText = value; } };
  const combinedOutput = { textContent: 'stale', hidden: false, classList: { add() { combinedOutput.hidden = true; } } };
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-scenario-name]') return [visibleName];
      if (selector === '[data-scenario-thesis]') return [visibleThesis];
      if (selector === '[data-scenario-id]') return [visibleChoice];
      return [];
    },
    querySelector(selector) { return selector === '[data-step-combined="2"]' ? combinedOutput : null; }
  };
  const state = { scenariosMap: { selectedScenarioId: 's1', scenarios: [scenario] }, stepChoiceMaps: { 2: { selectedIds: ['2-0', '2-1'], combinedText: 'stale' } } };
  const updateScenarioField = new Function(
    'demoState', 'document',
    `${functionSource(source, 'updateScenarioField')}; return updateScenarioField;`
  )(state, document);

  updateScenarioField('s1', 'name', '<img src=x onerror=alert(1)>');
  updateScenarioField('s1', 'thesis', '<script>alert(1)</script>');

  assert.equal(visibleName.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(visibleThesis.textContent, '<script>alert(1)</script>');
  assert.equal(scenario.name, visibleName.textContent);
  assert.equal(scenario.thesis, visibleThesis.textContent);
  assert.equal(visibleChoice.choiceText, '<img src=x onerror=alert(1)> — <script>alert(1)</script>');
  assert.equal(state.stepChoiceMaps[2].combinedText, '');
  assert.equal(combinedOutput.textContent, '');
  assert.equal(combinedOutput.hidden, true);
});

test('Build clears stale scenario state before requesting a fresh generation', async () => {
  const { scripts } = await loadDemo();
  const runStep = functionSource(scripts.join('\n'), 'runStep');
  const resetAt = runStep.indexOf('if (stepIdx === 2) demoState.scenariosMap = null;');
  const requestAt = runStep.indexOf('callMistralViaProxy');

  assert.ok(resetAt >= 0, 'Build must clear any canvas left by an earlier cycle or failed rerun');
  assert.ok(resetAt < requestAt, 'stale state must be cleared before the generation request can fail');
});

test('steps 3 to 7 turn structured or malformed output into readable selectable text modules', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const buildReadableStepPanel = new Function(
    'extractJsonValue', 'escapeHtml', 't', 'markdownishToHtml', 'demoState',
    `${functionSource(source, 'buildReadableStepPanel')}; return buildReadableStepPanel;`
  )(
    (raw) => JSON.parse(raw),
    (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    (key) => key,
    (value) => `<p>${String(value)}</p>`,
    { stepChoiceMaps: {} }
  );
  const raw = JSON.stringify({
    entities: ['plateforme maintenance prédictive IoT', 'techniciens autonomes'],
    relations: ['la plateforme forme les techniciens'],
    gaps: [{ label: 'Certification indépendante', opportunity: 'Créer un standard commun' }]
  });

  for (const stepIdx of [2, 3, 4, 5, 6]) {
    const panel = buildReadableStepPanel(raw, stepIdx, 'fr');
    assert.match(panel, /data-readable-output/);
    assert.match(panel, new RegExp(`data-step-choice="${stepIdx}-0"`));
    assert.match(panel, new RegExp(`data-step-combine="${stepIdx}"`));
    assert.match(panel, /break-words/);
    assert.doesNotMatch(panel, /\{"entities"/, 'raw JSON syntax must never be the visible presentation');
  }
  const english = buildReadableStepPanel(JSON.stringify({ go_conditions: ['Validate pilot'] }), 5, 'en');
  assert.match(english, /GO conditions/);
  assert.doesNotMatch(english, /go_conditions/);
});

test('readable fallback escapes generated HTML and preserves narrative paragraphs', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const buildReadableStepPanel = new Function(
    'extractJsonValue', 'escapeHtml', 't', 'markdownishToHtml', 'demoState',
    `${functionSource(source, 'buildReadableStepPanel')}; return buildReadableStepPanel;`
  )(
    () => { throw new SyntaxError('not JSON'); },
    (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    (key) => key,
    (value) => `<p>${String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`,
    { stepChoiceMaps: {} }
  );

  const panel = buildReadableStepPanel('### Synthèse\n- Option A\n- <script>alert(1)</script>', 6, 'fr');

  assert.match(panel, /Synthèse/);
  assert.match(panel, /Option A/);
  assert.doesNotMatch(panel, /<script>/);
  assert.match(panel, /data-step-choice="6-0"/);
});

test('scenario canvas stays within its column and keeps editing secondary to readable choices', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const buildScenariosPanel = new Function(
    'escapeHtml', 't',
    `${functionSource(source, 'buildScenariosPanel')}; return buildScenariosPanel;`
  )((value) => String(value), (key) => key);
  const panel = buildScenariosPanel({ scenarios: [
    { id: 's1', name: 'Un intitulé de scénario volontairement très long pour tester le retour à la ligne', thesis: 'Une thèse longue mais lisible.', feasibility: 8, horizon: '3 ans', falsifiable_hypothesis: 'Hypothèse', first_test: 'Test' },
    { id: 's2', name: 'Option B', thesis: 'Thèse B', feasibility: 6, horizon: '5 ans', falsifiable_hypothesis: 'Hypothèse B', first_test: 'Test B' }
  ] }, 'fr');

  assert.doesNotMatch(panel, /sm:grid-cols-3/);
  assert.match(panel, /min-w-0/);
  assert.match(panel, /overflow-hidden/);
  assert.match(panel, /break-words/);
  assert.match(panel, /<details/);
  assert.match(panel, /data-step-choice="2-0"/);
  assert.match(panel, /data-step-combine="2"/);
});

test('scenario controls keep generated identifiers out of inline JavaScript', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const buildScenariosPanel = new Function(
    'escapeHtml', 't',
    `${functionSource(source, 'buildScenariosPanel')}; return buildScenariosPanel;`
  )((value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), (key) => key);
  const hostileId = `s1' onclick="alert(1)`;
  const panel = buildScenariosPanel({ selectedScenarioId: hostileId, scenarios: [
    { id: hostileId, name: 'Option A', thesis: 'Thèse A', feasibility: 7, horizon: '2 ans', falsifiable_hypothesis: 'Hypothèse', first_test: 'Test' },
    { id: 's2', name: 'Option B', thesis: 'Thèse B', feasibility: 6, horizon: '3 ans', falsifiable_hypothesis: 'Hypothèse B', first_test: 'Test B' }
  ] }, 'fr');

  assert.doesNotMatch(panel, /onclick="alert\(1\)/);
  assert.doesNotMatch(panel, /selectScenario\('s1/);
  assert.match(panel, /selectScenario\(this\.dataset\.scenarioId\)/);
  assert.match(panel, /data-scenario-id="s1' onclick=&quot;alert\(1\)"/);
});

test('deselecting the primary scenario moves the primary selection to a retained scenario', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const map = {
    selectedScenarioId: 's2', selectedScenarioIds: ['s1', 's2'],
    scenarios: [{ id: 's1', name: 'Option A' }, { id: 's2', name: 'Option B' }]
  };
  const state = { scenariosMap: map, stepChoiceMaps: { 2: { selectedIds: ['2-0', '2-1'], combinedText: 'stale' } } };
  const selectScenario = new Function(
    'demoState', 'document', 'buildScenariosPanel', 'cycleLanguage',
    `${functionSource(source, 'selectScenario')}; return selectScenario;`
  )(state, { getElementById: () => null }, () => '', () => 'fr');

  selectScenario('s2');

  assert.deepEqual(map.selectedScenarioIds, ['s1']);
  assert.equal(map.selectedScenarioId, 's1');
  assert.ok(map.selectedScenarioIds.includes(map.selectedScenarioId));
  assert.equal(state.stepChoiceMaps[2].combinedText, '');
});

test('runStep uses readable presentation and replaces raw output with specialized panels through step 7', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const runStep = functionSource(source, 'runStep');

  assert.match(runStep, /contentHtml\s*=\s*buildReadableStepPanel\(raw,\s*stepIdx,\s*lang\)/);
  assert.match(runStep, /stepIdx\s*===\s*4[\s\S]*contentHtml\s*=\s*buildRiskPanel/);
  assert.match(runStep, /stepIdx\s*===\s*5[\s\S]*contentHtml\s*=\s*buildDecisionPanel/);
  assert.doesNotMatch(runStep, /contentHtml\s*\+=\s*buildOntologyPanel/, 'Position must replace raw JSON rather than append a panel after it');
  assert.match(functionSource(source, 'buildDecisionPanel'), /lang==='en'\?'Conditional GO':'GO conditionnel'/);
});

test('the specialized risk panel keeps decisive and secondary attacks visible', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const normalizeRiskMap = new Function(
    'extractJsonValue',
    `${functionSource(source, 'normalizeRiskMap')}; return normalizeRiskMap;`
  )(JSON.parse);
  const buildRiskPanel = new Function(
    'escapeHtml', 't', 'buildStepCombineFooter',
    `${functionSource(source, 'buildRiskPanel')}; return buildRiskPanel;`
  )((value) => String(value), (key) => key, () => '');
  const panel = buildRiskPanel(normalizeRiskMap(JSON.stringify({
    risks: [{ id: 'r1', label: 'Adoption risk', severity: 4, likelihood: 3, mitigation: 'Pilot' }],
    kill_criteria: ['No sponsor'], decisive_attack: 'Interview ten buyers', noise_attacks: ['Landing page test']
  })), 'en');

  assert.match(panel, /Interview ten buyers/);
  assert.match(panel, /Landing page test/);
  assert.match(panel, /Decisive test/);
  assert.match(panel, /Secondary tests/);
});

test('combined readable choices are stored safely and forwarded only to downstream steps', async () => {
  const { scripts } = await loadDemo();
  const source = scripts.join('\n');
  const demoState = { currentStep: 5, stepChoiceMaps: {}, scenariosMap: null };
  const output = { textContent: '', hidden: true, classList: { remove() { output.hidden = false; }, add() { output.hidden = true; } } };
  const buttons = [
    { id: '3-0', text: 'Option <b>A</b>', pressed: 'false' },
    { id: '3-1', text: 'Option B', pressed: 'false' }
  ].map((value) => ({
    getAttribute(name) { return name === 'data-step-choice' ? value.id : value.text; },
    setAttribute(name, next) { if (name === 'aria-pressed') value.pressed = next; },
    classList: { toggle() {} }
  }));
  const document = {
    querySelectorAll() { return buttons; },
    querySelector(selector) {
      if (selector === '[data-step-combined="3"]') return output;
      const match = selector.match(/data-step-choice="([^"]+)/);
      return match ? buttons.find((button) => button.getAttribute('data-step-choice') === match[1]) : null;
    }
  };
  const toggle = new Function('demoState', 'document', `${functionSource(source, 'toggleStepChoice')}; return toggleStepChoice;`)(demoState, document);
  const combine = new Function('demoState', 'document', 't', 'cycleLanguage', `${functionSource(source, 'combineStepChoices')}; return combineStepChoices;`)(demoState, document, (key) => key, () => 'fr');

  toggle(3, '3-0');
  toggle(3, '3-1');
  combine(3);

  assert.equal(demoState.stepChoiceMaps[3].combinedText, 'Option <b>A</b> + Option B');
  assert.equal(output.textContent, 'readable_combined : Option <b>A</b> + Option B');

  toggle(3, '3-1');
  assert.equal(demoState.stepChoiceMaps[3].combinedText, '', 'changing selection invalidates the previous combination');
  assert.equal(output.textContent, '');
  assert.equal(output.hidden, true);

  toggle(3, '3-1');
  combine(3);
  demoState.stepChoiceMaps[5] = { combinedText: 'Current step must not leak' };
  const prompt = new Function('demoState', 't', `${functionSource(source, 'buildUserPrompt')}; return buildUserPrompt;`)(demoState, (key) => key)('Idea', {}, [], 'fr');
  assert.match(prompt, /Option <b>A<\/b> \+ Option B/);
  assert.doesNotMatch(prompt, /Current step must not leak/);
});
