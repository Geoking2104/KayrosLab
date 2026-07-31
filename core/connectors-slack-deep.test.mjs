import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  timingSafeEqual,
  platformUserId,
  createIdempotenceStore,
  slackInteractionId,
  viewToSlackWebhookBody,
} from './connectors-slack-deep.mjs';

describe('slack deep helpers', () => {
  it('timingSafeEqual', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('ab', 'abc'), false);
  });

  it('platformUserId prefixes', () => {
    assert.equal(platformUserId('slack', 'U123'), 'slack:U123');
    assert.equal(platformUserId('slack', 'slack:U123'), 'slack:U123');
    assert.equal(platformUserId('slack', null), null);
  });

  it('idempotence store', () => {
    const store = createIdempotenceStore(3);
    assert.equal(store.seen('a'), false);
    assert.equal(store.seen('a'), true);
    store.seen('b'); store.seen('c'); store.seen('d');
    assert.ok(store.size() <= 3);
  });

  it('slackInteractionId from block_actions', () => {
    const id = slackInteractionId({
      user: { id: 'U1' },
      actions: [{ action_id: 'approve:g1' }],
      message: { ts: '1.2' },
    });
    assert.equal(id, 'slack:U1:approve:g1:1.2');
  });

  it('viewToSlackWebhookBody', () => {
    const body = viewToSlackWebhookBody(
      { title: 'Gate open' },
      () => [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }],
    );
    assert.equal(body.text, 'Gate open');
    assert.equal(body.blocks.length, 1);
  });
});
