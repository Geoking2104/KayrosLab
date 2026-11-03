// P9 : les migrations déjà livrées sont figées (liste + SHA-256). Modifier, renommer ou supprimer
// une migration livrée fait échouer ce test ; une nouvelle migration doit être déclarée dans le verrou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'sql', 'migrations');
const lock = JSON.parse(readFileSync(join(dir, '..', 'migrations.lock.json'), 'utf8')).migrations;
const sha = (f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');

test('migrations livrées : présentes et inchangées (SHA-256 figé)', () => {
  for (const [file, expected] of Object.entries(lock)) {
    assert.ok(existsSync(join(dir, file)), `migration livrée supprimée ou renommée : ${file}`);
    assert.equal(sha(file), expected, `migration livrée modifiée : ${file} — créer une nouvelle migration plutôt`);
  }
});

test('toute migration présente est déclarée dans le verrou, et ordonnée après les livrées', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const undeclared = files.filter((f) => !(f in lock));
  assert.deepEqual(undeclared, [], `migration non déclarée dans core/sql/migrations.lock.json : ${undeclared.join(', ')}`);
  const declared = Object.keys(lock);
  assert.deepEqual(declared, [...declared].sort(), 'le verrou doit rester trié (ordre d’application)');
});
