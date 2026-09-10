import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);

test('Salon HTML : viewport, grilles fluides, breakpoints', async () => {
  const html = await readFile(new URL('salon/index.html', root), 'utf8');
  const published = await readFile(new URL('backend/web/public/salon/index.html', root), 'utf8');
  for (const page of [html, published]) {
    assert.match(page, /viewport-fit=cover/);
    assert.match(page, /--pad-x: clamp/);
    assert.match(page, /safe-area-inset-left/);
    assert.match(page, /minmax\(min\(16rem, 100%\), 1fr\)/);
    assert.match(page, /minmax\(min\(13rem, 100%\), 1fr\)/);
    assert.match(page, /@media \(max-width: 719px\)/);
    assert.match(page, /@media \(max-width: 479px\)/);
    assert.match(page, /@media \(min-width: 1100px\)/);
    assert.match(page, /font-size: 1rem/);
    assert.match(page, /overflow-x: clip/);
    assert.doesNotMatch(page, /@media \(min-width: 960px\)/);
  }
});
