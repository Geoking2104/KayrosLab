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
