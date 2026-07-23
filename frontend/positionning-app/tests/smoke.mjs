import { describe, it, before } from 'node:test';
import assert from 'node:assert';

let ontology, i18n, scanner;

before(async () => {
  ontology = await import('../src/data/ontology.js');
  i18n = await import('../src/i18n/index.js');
  scanner = await import('../src/collectors/scanner.js');
});

describe('ontology data', () => {
  it('exporte ENTITY_TYPES avec 14 elements', () => {
    assert.equal(ontology.ENTITY_TYPES.length, 14);
  });

  it('chaque entite a un id, name, group, icon, color', () => {
    for (const et of ontology.ENTITY_TYPES) {
      assert.ok(et.id, `id manquant pour ${et.name}`);
      assert.ok(et.name, 'name manquant');
      assert.ok(['tech', 'business'].includes(et.group), `group invalide pour ${et.name}`);
      assert.ok(et.icon, `icon manquant pour ${et.name}`);
      assert.ok(et.color, `color manquant pour ${et.name}`);
    }
  });

  it('RELATIONSHIPS contient 13 relations', () => {
    assert.equal(ontology.RELATIONSHIPS.length, 13);
  });

  it('getEntity retourne une entite valide', () => {
    const arch = ontology.getEntity('architecture');
    assert.ok(arch);
    assert.equal(arch.name, 'Architecture');
  });

  it('getEntity retourne null pour un id inconnu', () => {
    assert.equal(ontology.getEntity('unknown'), undefined);
  });
});

describe('i18n', () => {
  it('retourne la traduction anglaise du titre', () => {
    assert.equal(i18n.t('en', 'app.title'), 'Positionner');
  });

  it('retourne la traduction francaise du titre', () => {
    assert.equal(i18n.t('fr', 'app.title'), 'Positionner');
  });

  it('retourne un fallback pour une clef inconnue', () => {
    assert.equal(i18n.t('en', 'nonexistent.key', 'fallback'), 'fallback');
  });

  it('useI18n retourne les bonnes methodes', () => {
    const ctx = i18n.useI18n('fr');
    assert.equal(ctx.locale, 'fr');
    assert.equal(typeof ctx.t('app.title'), 'string');
    assert.equal(ctx.isRtl, false);
  });
});

describe('scanner exports', () => {
  it('exporte searchCompetitors', () => {
    assert.equal(typeof scanner.searchCompetitors, 'function');
  });

  it('exporte searchGitHub', () => {
    assert.equal(typeof scanner.searchGitHub, 'function');
  });

  it('exporte searchArXiv', () => {
    assert.equal(typeof scanner.searchArXiv, 'function');
  });

  it('exporte analyzeIdea', () => {
    assert.equal(typeof scanner.analyzeIdea, 'function');
  });
});
