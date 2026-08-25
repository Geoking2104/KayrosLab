import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../portfolio-board.html', import.meta.url), 'utf8');

test('portfolio inline JavaScript remains syntactically valid', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim() && !source.includes('tailwind.config'));
  assert.ok(scripts.length > 0);
  for (const source of scripts) assert.doesNotThrow(() => new Function(source));
});

test('portfolio exposes the governed TimesFM simulation flow', () => {
  assert.match(html, /TimesFM 2\.5 · simulation/);
  assert.match(html, /\/v1\/ideas\/.*\/forecast/);
  assert.match(html, /P10–P90/);
  assert.match(html, /requires_human_review/);
});

test('live portfolio defaults to the production API and keeps authentication', () => {
  assert.match(html, /https:\/\/api\.kayroslab\.com/);
  assert.match(html, /Authorization = 'Bearer '/);
  assert.match(html, /encodeURIComponent\(selectedIdeaId\)/);
});
