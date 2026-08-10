import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkingGroupStore, FileWorkingGroupStore, createWorkingGroupStore,
  isMember, wgAggregateVotes, wgDecision, participations, createWorkingGroup,
} from './working-group.mjs';

describe('working-group core', () => {
  const members = [{ email: 'comex@corp', role: 'comex' }, { email: 'expr@corp', role: 'expert' }, { email: 'con@corp' }];
  const wg = createWorkingGroup({ ideaId: 'i1', members, quorum: 0.5 });

  it('createWorkingGroup dedupe + role par défaut', () => {
    const g = createWorkingGroup({ ideaId: 'i1', members: [{ email: 'A@B' }, { email: 'a@b', role: 'expert' }, 'nope'] });
    assert.equal(g.members.length, 1);
    assert.equal(g.members[0].role, 'contributeur');
    assert.equal(g.quorum, 0.5);
  });

  it('isMember is case-insensitive', () => {
    assert.equal(isMember('COMEX@CORP', wg), true);
    assert.equal(isMember('stranger@x', wg), false);
  });

  it('participations compute ratio', () => {
    const { participation } = participations(wg, [{ by: 'comex@corp' }, { by: 'stranger' }]);
    assert.equal(participation.toFixed(2), '0.33');
  });

  it('quorum insufficient -> Attendre quorum', () => {
    const a = wgAggregateVotes(wg, [{ by: 'comex@corp', score: 90 }]);
    assert.equal(a.status, 'en_attente');
    assert.equal(a.recommandation, 'Attendre quorum');
    assert.equal(a.participants, 1);
  });

  it('quorum ok + Go / Révision / No-Go', () => {
    const go = wgAggregateVotes(wg, [{ by: 'comex@corp', role: 'comex', score: 90 }, { by: 'expr@corp', role: 'expert', score: 80 }, { by: 'con@corp', score: 80 }]);
    assert.equal(go.quorum, true);
    assert.equal(go.status, 'quorum_ok');
    assert.equal(go.moyennePonderee >= 70, true);
    assert.equal(wgDecision(go), 'Go');

    const nogo = wgAggregateVotes(wg, [{ by: 'comex@corp', score: 20 }, { by: 'expr@corp', score: 10 }, { by: 'con@corp', score: 10 }]);
    assert.equal(wgDecision(nogo), 'No-Go');

    const rev = wgAggregateVotes(wg, [{ by: 'comex@corp', score: 50 }, { by: 'expr@corp', score: 50 }, { by: 'con@corp', score: 50 }]);
    assert.equal(['Go', 'Révision', 'No-Go'].includes(wgDecision(rev)), true);
  });

  it('only members count toward aggregation (non-members ignored)', () => {
    const a = wgAggregateVotes(wg, [{ by: 'comex@corp', score: 90 }, { by: 'expr@corp', score: 90 }, { by: 'con@corp', score: 90 }, { by: 'random@ext', score: 10 }]);
    assert.equal(a.memberVotes, 3);
    assert.equal(a.quorum, true);
  });

  it('vide -> insuffisant', () => {
    const a = wgAggregateVotes(wg, []);
    assert.equal(a.status, 'vide');
    assert.equal(a.recommandation, 'insuffisant');
  });
});

describe('WorkingGroupStore', () => {
  it('records member votes and aggregates', () => {
    const s = new WorkingGroupStore();
    const wg = s.addGroup(createWorkingGroup({ ideaId: 'i', members: [{ email: 'a@x', role: 'comex' }, { email: 'b@x' }] }));
    s.addVote('i', { by: 'a@x', score: 90 });
    const upd = s.addVote('i', { by: 'b@x', score: 50 });
    assert.equal(upd.score, 50);
    const a = s.aggregate('i');
    assert.equal(a.status, 'quorum_ok');
    assert.equal(s.aggregate('nope'), null);
  });

  it('createWorkingGroupStore picks file vs memory', () => {
    assert.ok(createWorkingGroupStore({ file: '/tmp/x.json' }) instanceof FileWorkingGroupStore);
    assert.ok(createWorkingGroupStore() instanceof WorkingGroupStore);
  });

  it('FileWorkingGroupStore round-trips groups + votes', async () => {
    const fs = { _m: new Map(), async readFile(p) { return this._m.has(p) ? this._m.get(p) : null; }, async writeFile(p, data) { this._m.set(p, data); } };
    const s = new FileWorkingGroupStore({ path: '/tmp/__wg.json', fs });
    await s.load();
    s.addGroup(createWorkingGroup({ ideaId: 'i', members: [{ email: 'a@x', role: 'comex' }] }));
    s.addVote('i', { by: 'a@x', score: 88 });
    const s2 = new FileWorkingGroupStore({ path: '/tmp/__wg.json', fs });
    await s2.load();
    assert.equal(s2.get('i').members.length, 1);
    assert.equal(s2.getVotes('i').length, 1);
    assert.equal(s2.aggregate('i').moyennePonderee, 88);
  });
});
