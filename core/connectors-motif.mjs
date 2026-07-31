// Slack motif modal + post-resolve message update helpers (v14).

import { AbstractView, AbstractAction } from './connectors.mjs';

/**
 * Build Slack modal view JSON for reject/revise reason (Block Kit).
 * @param {{ decision: 'reject'|'revise', gateId: string, channelId?: string, messageTs?: string }}
 */
export function buildMotifModal({ decision, gateId, channelId = '', messageTs = '' }) {
  const isReject = decision === 'reject';
  const title = isReject ? 'Reject reason' : 'Revision reason';
  const private_metadata = JSON.stringify({
    decision,
    gateId,
    channelId,
    messageTs,
  });
  return {
    type: 'modal',
    callback_id: `gate_motif:${decision}:${gateId}`,
    private_metadata,
    title: { type: 'plain_text', text: title.slice(0, 24) },
    submit: { type: 'plain_text', text: 'Confirm' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: isReject
            ? 'A written *motif* is required for veto. It is timestamped in the audit trail.'
            : 'Describe the revision expected. The idea returns to *Challenge*.',
        },
      },
      {
        type: 'input',
        block_id: 'motif_block',
        label: { type: 'plain_text', text: 'Motif' },
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: isReject ? 'Why is this a no-go?' : 'What must change?',
          },
        },
      },
    ],
  };
}

/** Parse private_metadata / callback from view_submission. */
export function parseMotifSubmission(body = {}) {
  const cb = body.view?.callback_id || '';
  let decision = null;
  let gateId = null;
  if (cb.startsWith('gate_motif:')) {
    const parts = cb.split(':');
    decision = parts[1] || null;
    gateId = parts[2] || null;
  }
  let meta = {};
  try {
    meta = JSON.parse(body.view?.private_metadata || '{}');
  } catch {
    meta = {};
  }
  const values = body.view?.state?.values ?? {};
  let reason = '';
  for (const block of Object.values(values)) {
    if (block.reason?.value) reason = String(block.reason.value).trim();
  }
  return {
    decision: decision || meta.decision || null,
    gateId: gateId || meta.gateId || null,
    reason,
    channelId: meta.channelId || body.view?.private_metadata || null,
    messageTs: meta.messageTs || null,
    userId: body.user?.id || null,
  };
}

/**
 * After gate resolve: replace original Block Kit message with result view.
 */
export async function updateGateMessage(adapter, { channelId, messageTs, resolution, ideaTitre }) {
  if (!adapter || typeof adapter.updateMessage !== 'function') return { ok: false, skipped: true };
  if (!channelId || !messageTs) return { ok: false, skipped: true };
  const view =
    typeof adapter.buildGateResultView === 'function'
      ? adapter.buildGateResultView(resolution, { ideaTitre })
      : new AbstractView({
          title: `${resolution.decision} — ${ideaTitre || ''}`,
          text: `By: ${resolution.by || '—'}\nMotif: ${resolution.reason || '—'}`,
          actions: [],
        });
  try {
    return await adapter.updateMessage(channelId, messageTs, view);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function isMotifCallback(actionId) {
  return typeof actionId === 'string' && actionId.startsWith('gate_motif:');
}
