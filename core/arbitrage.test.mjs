import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArbitrageDecision, recordDecision, decisionsTimeline, lastDecision,
  buildSyntheseArbitrage, ARBITRAGE_DECISIONS, DECISION_MAPPING,
} from './arbitrage.mjs';

const idea = (extra = {}) => ({ id: 'i1', title: 'Idée test', stage: 'eprouver', status: 'en_revue', ...extra });

describe('arbitrage COMEX (EF-14 / F1)', () => {
  it('normalizeArbitrageDecision mappe les aliases vers Go/No-Go/Révision', () => {
    assert.equal(normalizeArbitrageDecision('Go'), 'Go');
    assert.equal(normalizeArbitrageDecision('approve'), 'Go');
    assert.equal(normalizeArbitrageDecision('validated_human'), 'Go');
    assert.equal(normalizeArbitrageDecision('No-Go'), 'No-Go');
    assert.equal(normalizeArbitrageDecision('veto'), 'No-Go');
    assert.equal(normalizeArbitrageDecision('blocked_veto'), 'No-Go');
    assert.equal(normalizeArbitrageDecision('Révision'), 'Révision');
    assert.equal(normalizeArbitrageDecision('revise'), 'Révision');
    assert.equal(normalizeArbitrageDecision('inconnu'), null);
    assert.deepEqual(ARBITRAGE_DECISIONS, ['Go', 'No-Go', 'Révision']);
  });

  it('recordDecision ajoute une decision horodatée et signée (append-only)', () => {
    const out = recordDecision(idea(), {
      decision: 'reject', by: 'arbitre@kayros.local', role: 'comex', reason: 'trop risqué', gateId: 'g1',
    });
    assert.equal(out.decisions.length, 1);
    const d = out.decisions[0];
    assert.equal(d.seq, 1);
    assert.equal(d.decision, 'No-Go');
    assert.equal(d.by, 'arbitre@kayros.local');
    assert.equal(d.role, 'comex');
    assert.equal(d.reason, 'trop risqué');
    assert.equal(d.gateId, 'g1');
    assert.ok(d.ts);
  });

  it('recordDecision est append-only : les enregistrements passés ne changent jamais', () => {
    const base = idea();
    const once = recordDecision(base, { decision: 'Go', by: 'a@x', ts: '2026-01-01T00:00:00.000Z' });
    const twice = recordDecision(once, { decision: 'revise', by: 'b@x', ts: '2026-02-01T00:00:00.000Z' });
    assert.equal(twice.decisions.length, 2);
    assert.equal(twice.decisions[1].seq, 2);
    assert.equal(twice.decisions[0].decision, 'Go'); // record 1 intact
    assert.equal(once.decisions.length, 1);          // once non modifié
    assert.equal(base.decisions, undefined);          // idée source intacte
    assert.throws(() => recordDecision(base, { decision: 'peut-être', by: 'a@x' }));
    assert.throws(() => recordDecision(base, { decision: 'Go', by: '' }));
  });

  it('decisionsTimeline trie du plus récent au plus ancien et reste en lecture seule', () => {
    const out = recordDecision(recordDecision(idea(), {
      decision: 'Go', by: 'a@x', ts: '2026-01-01T00:00:00.000Z',
    }), {
      decision: 'No-Go', by: 'b@x', ts: '2026-03-01T00:00:00.000Z',
    });
    const t = decisionsTimeline(out);
    assert.equal(t[0].decision, 'No-Go');
    assert.equal(t[1].decision, 'Go');
    t[0].decision = 'muté';
    assert.equal(out.decisions[1].decision, 'No-Go'); // copie, pas référence
  });

  it('lastDecision retourne la décision la plus récente', () => {
    const out = recordDecision(recordDecision(idea(), {
      decision: 'Go', by: 'a@x', ts: '2026-01-01T00:00:00.000Z',
    }), {
      decision: 'No-Go', by: 'b@x', ts: '2026-03-01T00:00:00.000Z',
    });
    assert.equal(lastDecision(out).decision, 'No-Go');
    assert.equal(lastDecision(idea()), null);
  });

  it('buildSyntheseArbitrage compose redFlags depuis la matrice réelle', () => {
    const risques = [
      { id: 'r1', libelle: 'Churn marché', probabilite: 0.9, impact: 0.9 },
      { id: 'r2', libelle: 'Dérapage budget', probabilite: 0.3, impact: 0.3 },
    ];
    const s = buildSyntheseArbitrage({ idea: idea(), risques });
    assert.equal(s.redFlags.length, 1);          // r1 critique
    assert.equal(s.redFlags[0].libelle, 'Churn marché');
    assert.equal(s.redFlags[0].niveau, 'critique');
    assert.equal(s.matriceRisques.total, 2);
    assert.equal(s.redFlags[0].probabilite, 0.9); // aucun nombre inventé
  });

  it('buildSyntheseArbitrage reprend la recommandation WG et les gates en attente', () => {
    const wgAggregat = { count: 3, moyennePonderee: 78.5, recommandation: 'Go' };
    const s = buildSyntheseArbitrage({
      idea: idea(),
      wgAggregat,
      pendingGates: [{ gateId: 'g1', type: 'validation', requiredRole: 'comex', createdAt: 'x' }],
    });
    assert.deepEqual(s.recommandation, wgAggregat);
    assert.equal(s.gatesEnAttente.length, 1);
    assert.ok(s.synthèse.includes('Recommandation du groupe de travail : Go'));
    assert.ok(s.synthèse.includes('Gate(s) en attente'));
  });

  it('DECISION_MAPPING aligne verdicts et status idée', () => {
    assert.deepEqual(DECISION_MAPPING.Go, { status: 'en_developpement', stage: 'projeter' });
    assert.deepEqual(DECISION_MAPPING['No-Go'], { status: 'non_poursuivi', stage: null });
    assert.deepEqual(DECISION_MAPPING.Révision, { status: 'en_revue', stage: 'eprouver' });
  });
});
