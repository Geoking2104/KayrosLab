import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapitalisation, addApprentissage, reactivationReady, resumeCapitalisation } from './capitalisation.mjs';

describe('capitalisation No-Go (EF-44)', () => {
  it('buildCapitalisation normalise apprentissages/signaux/conditions', () => {
    const d = buildCapitalisation({
      apprentissages: ['Ne pas lancer sans preuve de demande', { contenu: 'RGPD bloquant', categorie: 'reglementaire' }],
      reactivation: { conditions: ['Marche legalise en UE'], delai: '12 mois', signaux: ['loi', 'directive'] },
      signaux: ['directive UE', 'concurrent en retrait'],
      motif: 'risque regulatoire',
    });
    assert.equal(d.type, 'capitalisation');
    assert.equal(d.apprentissages.length, 2);
    assert.equal(d.apprentissages[0].contenu, 'Ne pas lancer sans preuve de demande');
    assert.equal(d.apprentissages[1].categorie, 'reglementaire');
    assert.equal(d.reactivation.conditions.length, 1);
    assert.equal(d.reactivation.delai, '12 mois');
    assert.equal(d.reactivation.signaux[0].libelle, 'loi');
    assert.equal(d.signaux.length, 2);
  });

  it('reactivation string -> condition simple', () => {
    const d = buildCapitalisation({ reactivation: 'Marche legalise en UE' });
    assert.equal(d.reactivation.conditions[0].condition, 'Marche legalise en UE');
  });

  it('addApprentissage append de facon immuable', () => {
    const d = buildCapitalisation({ apprentissages: ['a'] });
    const d2 = addApprentissage(d, 'b');
    assert.equal(d.apprentissages.length, 1);
    assert.equal(d2.apprentissages.length, 2);
  });

  it('reactivationReady : prete quand toutes les conditions sont satisfaites', () => {
    const d = buildCapitalisation({ reactivation: { condition: 'legalisation marche', signaux: ['loi adoptée'] } });
    const ok = reactivationReady(d, { contexteSignaux: ['la loi adoptée est publiee'] });
    assert.equal(ok.prete, true);
    assert.equal(ok.manquantes.length, 0);
    const ko = reactivationReady(d, { contexteSignaux: ['aucun signal'] });
    assert.equal(ko.prete, false);
    assert.equal(ko.manquantes.length, 1);
  });

  it('reactivationReady : sans conditions, jamais prete', () => {
    const d = buildCapitalisation({ reactivation: null });
    assert.equal(reactivationReady(d).prete, false);
  });

  it('resumeCapitalisation synthetise le dossier', () => {
    const r = resumeCapitalisation(buildCapitalisation({ apprentissages: ['a', 'b'], reactivation: { conditions: ['x'] }, signaux: ['s'] }));
    assert.equal(r.nbApprentissages, 2);
    assert.equal(r.nbConditionsReactivation, 1);
    assert.match(r.titre, /2 apprentissages, 1 condition/);
  });
});
