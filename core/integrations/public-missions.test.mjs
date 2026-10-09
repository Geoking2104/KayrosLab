import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryPublicMissionStore, MissionEventPublisher } from './public-missions.mjs';
import { IntegrationSettingsService } from './webhooks.mjs';

function setup(mission, settings = null) {
  const missions = new InMemoryPublicMissionStore();
  const integrationSettings = new IntegrationSettingsService();
  const sent = [];
  const dispatcher = { enqueue: async ({ event, targets }) => { sent.push({ event: event.event, targets }); return targets; } };
  const publisher = new MissionEventPublisher({ missions, settings: integrationSettings, dispatcher, consoleUrl: 'https://console.test', logger: null });
  return { missions, integrationSettings, publisher, sent, ready: (async () => {
    await missions.insert(mission);
    if (settings) await integrationSettings.update('t1', settings);
  })() };
}
const base = { mission_id: 'msn_1', tenant_id: 't1', thread_id: 'thread_1', room_id: 'room_1', question: 'Q ?', profile: 'demo', created_at: new Date().toISOString() };
const thread = { thread_id: 'thread_1', status: 'awaiting_arbitration', runs: [] };

test('callback_events filtre les événements envoyés à callback_url (URL de reprise n8n à usage unique)', async () => {
  const { publisher, sent, ready } = setup({ ...base, callback_url: 'https://n8n.example.com/webhook-waiting/42', callback_events: ['mission.completed', 'mission.failed'] });
  await ready;
  await publisher.publish('completed', thread);
  await publisher.publish('arbitrated', { ...thread, status: 'resolved' });
  assert.deepEqual(sent, [{ event: 'mission.completed', targets: ['https://n8n.example.com/webhook-waiting/42'] }]);
});

test('sans callback_events, callback_url reçoit tout ; l’abonnement du tenant suit ses propres événements', async () => {
  const { publisher, sent, ready } = setup({ ...base, callback_url: 'https://hooks.example.com/cb' }, { webhook_url: 'https://n8n.example.com/webhook/kayros-events', events: ['mission.arbitrated'] });
  await ready;
  await publisher.publish('completed', thread);
  await publisher.publish('arbitrated', { ...thread, status: 'resolved' });
  assert.deepEqual(sent.map((item) => [item.event, item.targets]), [
    ['mission.completed', ['https://hooks.example.com/cb']],
    ['mission.arbitrated', ['https://hooks.example.com/cb', 'https://n8n.example.com/webhook/kayros-events']],
  ]);
});
