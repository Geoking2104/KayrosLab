import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMotifModal, parseMotifSubmission, isMotifCallback } from './connectors-motif.mjs';
import { FileAccountLinkStore } from './account-link-store.mjs';

describe('v14 motif modal', () => {
  it('buildMotifModal encodes decision and gateId', () => {
    const m = buildMotifModal({
      decision: 'reject',
      gateId: 'g1',
      channelId: 'C1',
      messageTs: '1.2',
    });
    assert.equal(m.callback_id, 'gate_motif:reject:g1');
    assert.equal(m.type, 'modal');
    assert.ok(m.blocks.some((b) => b.type === 'input'));
    const meta = JSON.parse(m.private_metadata);
    assert.equal(meta.messageTs, '1.2');
  });

  it('parseMotifSubmission extracts reason', () => {
    const parsed = parseMotifSubmission({
      user: { id: 'U1' },
      view: {
        callback_id: 'gate_motif:revise:g9',
        private_metadata: JSON.stringify({ channelId: 'C9', messageTs: '9.9', decision: 'revise', gateId: 'g9' }),
        state: { values: { motif_block: { reason: { value: ' Need more data ' } } } },
      },
    });
    assert.equal(parsed.decision, 'revise');
    assert.equal(parsed.gateId, 'g9');
    assert.equal(parsed.reason, 'Need more data');
    assert.equal(parsed.messageTs, '9.9');
  });

  it('isMotifCallback', () => {
    assert.equal(isMotifCallback('gate_motif:reject:x'), true);
    assert.equal(isMotifCallback('approve:x'), false);
  });
});

describe('v14 FileAccountLinkStore', () => {
  it('round-trips in memory without path', async () => {
    const store = new FileAccountLinkStore();
    await store.load();
    await store.set('slack:U1', {
      platformId: 'slack:U1',
      kayrosUserId: 'u1',
      email: 'a@b.c',
      role: 'comex',
      tenantId: 't1',
    });
    assert.equal(store.get('slack:U1').email, 'a@b.c');
    assert.equal(store.size(), 1);
    await store.delete('slack:U1');
    assert.equal(store.get('slack:U1'), null);
  });
});
