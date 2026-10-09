// API publique v1 : la petite surface stable pour Zapier, n8n, Make,
// Salesforce… (docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md §3.3).
//
//   GET  /v1/public/me                       test de connexion
//   GET  /v1/public/collectives              collectifs utilisables (menus déroulants)
//   POST /v1/public/missions                 lance une mission (202, Idempotency-Key)
//   GET  /v1/public/missions/:id             statut + verdict à plat
//   GET  /v1/public/missions?external_ref=…  missions d'un objet CRM
//
// Authentification : `Authorization: Bearer kl_live_…` ou `X-Api-Key`.
// Les missions passent par le même gateway que la console (aucun moteur
// dupliqué) : elles apparaissent dans la console et s'y arbitrent.
import { z } from 'zod';
import { requireApiKey, apiKeyRateLimitKey } from '../lib/public-api-auth.mjs';
import {
  makeMissionId, missionView, parseExternalRef, requestFingerprint,
} from '../../../core/integrations/public-missions.mjs';
import { validateCallbackUrl, WEBHOOK_EVENTS } from '../../../core/integrations/webhooks.mjs';
import { EXECUTION_PROFILES, DEFAULT_PROFILE, profileRunOptions } from '../../../core/integrations/profiles.mjs';
import { makeThreadId } from '../../../core/hybrid-agent-gateway.mjs';

const externalRefSchema = z.union([
  z.string().min(3).max(300),
  z.object({
    system: z.string().min(1).max(40), object: z.string().max(80).optional(),
    id: z.string().min(1).max(120), url: z.string().url().max(1000).optional(),
  }),
]);
export const missionCreateSchema = z.object({
  collective_id: z.string().min(1).max(160),
  question: z.string().min(3).max(12000),
  context: z.string().max(24000).optional(),
  profile: z.enum(EXECUTION_PROFILES).optional(),
  external_ref: externalRefSchema.optional(),
  callback_url: z.string().max(2000).optional(),
  // Événements envoyés à callback_url (défaut : tous). n8n « Wait » : seulement
  // completed + failed, car son URL de reprise ne sert qu'une fois.
  callback_events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  metadata: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
});

function flag(value) { return /^(1|true|yes|on)$/i.test(String(value || '')); }
function startOfUtcDay() { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); }
function collectiveAllowed(principal, roomId) {
  return !principal.collectiveIds?.length || principal.collectiveIds.includes(roomId);
}
function collectiveView(swarm, room) {
  const configuration = swarm.getConfiguration?.(room.swarm_id, { tenantId: room.tenant_id });
  const agents = (configuration?.active_agents || []).map((id) => swarm.registry.get(id, { tenantId: room.tenant_id })).filter(Boolean);
  return {
    id: room.room_id, name: room.name, created_at: room.created_at,
    voting_threshold: configuration?.voting_threshold || 'majority',
    agents: agents.map((agent) => ({
      agent_id: agent.agent_id, name: agent.display_name || agent.role_name, role: agent.role_name,
      persona: !!agent.human_profile, veto_power: agent.veto_power === true,
    })),
  };
}
function missionContext(input, ref) {
  const lines = [];
  if (ref) lines.push(`Objet source : ${ref.system}${ref.object ? ` ${ref.object}` : ''} ${ref.id}`);
  for (const [key, value] of Object.entries(input.metadata || {})) if (value != null) lines.push(`${key} : ${value}`);
  if (input.context) lines.push(input.context);
  return lines.join('\n') || 'Mission reçue par l’API publique KayrosLab.';
}

export default async function publicApiRoutes(app) {
  const rateLimit = {
    max: Math.max(1, Number(process.env.KAYROS_PUBLIC_RATE_LIMIT) || 60),
    timeWindow: '1 minute',
    keyGenerator: apiKeyRateLimitKey,
  };
  const ctx = () => app.kayrosContext;
  const viewOptions = () => ({ consoleUrl: ctx().consoleUrl });

  app.get('/v1/public/me', { config: { rateLimit } }, async (req, reply) => {
    const principal = await requireApiKey(app, req, reply); if (!principal) return reply;
    return {
      tenant_id: principal.tenantId, key_id: principal.keyId, key_name: principal.keyName,
      service_account: principal.serviceAccount, scopes: [...principal.scopes],
      collective_ids: [...principal.collectiveIds],
      profiles: { default: DEFAULT_PROFILE, available: [...EXECUTION_PROFILES] },
    };
  });

  app.get('/v1/public/collectives', { config: { rateLimit } }, async (req, reply) => {
    const principal = await requireApiKey(app, req, reply, 'collectives:read'); if (!principal) return reply;
    const { engine, hybridGateway } = ctx();
    await engine.swarm.hydrateTenant?.(principal.tenantId);
    const rooms = (await hybridGateway.listRooms({ tenantId: principal.tenantId, platform: 'console' }))
      .filter((room) => room.status === 'active' && collectiveAllowed(principal, room.room_id));
    return { collectives: rooms.map((room) => collectiveView(engine.swarm, room)) };
  });

  app.post('/v1/public/missions', { config: { rateLimit } }, async (req, reply) => {
    const principal = await requireApiKey(app, req, reply, 'missions:write'); if (!principal) return reply;
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return reply.code(400).send({ error: 'en-tête Idempotency-Key requis (1 à 200 caractères), ex. sf-<OpportunityId>-<Stage>', code: 'idempotency_key_required' });
    }
    const parsed = missionCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'mission invalide', code: 'invalid_request', issues: parsed.error.issues });
    const input = parsed.data;
    const { publicMissions, hybridGateway, engine, llmConfig } = ctx();
    const fingerprint = requestFingerprint(input);

    const replay = async (existing) => {
      if (existing.request_sha256 && existing.request_sha256 !== fingerprint) {
        return reply.code(409).send({ error: 'Idempotency-Key déjà utilisée avec une requête différente', code: 'idempotency_key_reused', mission_id: existing.mission_id });
      }
      const thread = existing.thread_id ? await hybridGateway.getThread(existing.thread_id, { tenantId: principal.tenantId }) : null;
      return reply.code(200).header('idempotent-replayed', 'true').send({
        ...missionView(existing, thread, viewOptions()), poll_url: `/v1/public/missions/${existing.mission_id}`, replayed: true,
      });
    };
    const already = await publicMissions.findByIdempotencyKey(principal.tenantId, idempotencyKey);
    if (already) return replay(already);

    await engine.swarm.hydrateTenant?.(principal.tenantId);
    const room = await hybridGateway.getRoom(input.collective_id, { tenantId: principal.tenantId });
    if (!room || room.platform !== 'console' || room.status !== 'active' || !collectiveAllowed(principal, room.room_id)) {
      return reply.code(404).send({ error: 'collectif introuvable', code: 'collective_not_found' });
    }
    const perDay = Math.max(1, Number(process.env.KAYROS_PUBLIC_MISSIONS_PER_DAY) || 200);
    if (await publicMissions.countSince(principal.tenantId, startOfUtcDay()) >= perDay) {
      return reply.code(429).send({ error: `quota atteint : ${perDay} missions par jour et par tenant`, code: 'daily_quota_exceeded' });
    }
    let callbackUrl = null;
    if (input.callback_url) {
      try {
        callbackUrl = validateCallbackUrl(input.callback_url, {
          allowHttp: flag(process.env.KAYROS_WEBHOOK_ALLOW_HTTP), allowPrivate: flag(process.env.KAYROS_WEBHOOK_ALLOW_PRIVATE),
        });
      } catch (error) { return reply.code(400).send({ error: error.message, code: 'invalid_callback_url' }); }
    }
    const externalRef = parseExternalRef(input.external_ref);
    if (input.external_ref && !externalRef) return reply.code(400).send({ error: 'external_ref invalide (système:objet:id)', code: 'invalid_external_ref' });

    const options = profileRunOptions(input.profile || DEFAULT_PROFILE, {
      fastAvailable: !!llmConfig?.fast?.available, fastModel: llmConfig?.fast?.model,
      deepModel: llmConfig?.model, deepProvider: llmConfig?.provider,
    });
    const createdAt = new Date().toISOString();
    const mission = {
      mission_id: makeMissionId(), tenant_id: principal.tenantId, key_id: principal.keyId,
      service_account: principal.serviceAccount, idempotency_key: idempotencyKey, request_sha256: fingerprint,
      thread_id: makeThreadId(), room_id: room.room_id, question: input.question,
      profile: options.requested, effective_profile: options.effective_profile,
      external_ref: externalRef, callback_url: callbackUrl,
      callback_events: callbackUrl && input.callback_events ? [...new Set(input.callback_events)] : null,
      metadata: input.metadata || {},
      created_at: createdAt, updated_at: createdAt,
    };
    try { await publicMissions.insert(mission); }
    catch (error) {
      if (error.code === 'IDEMPOTENCY_CONFLICT' && error.existing) return replay(error.existing);
      throw error;
    }
    try {
      await hybridGateway.startMessage({
        platform: 'console', room_id: room.room_id, tenantId: principal.tenantId, thread_id: mission.thread_id,
        user_id: principal.sub, by: principal.email, explicit: true, text: input.question,
        context: missionContext(input, externalRef),
        provider: options.provider, model: options.model || undefined,
        profile: options.effective_profile, origin: 'public_api', allowConcurrent: true,
      });
    } catch (error) {
      // La clé d'idempotence est libérée : le client peut relancer la même requête.
      await publicMissions.remove(mission.mission_id).catch(() => {});
      return reply.code(error?.code === 'RUN_IN_PROGRESS' ? 409 : 400).send({ error: error.message, code: 'mission_not_started' });
    }
    const thread = await hybridGateway.getThread(mission.thread_id, { tenantId: principal.tenantId });
    return reply.code(202).send({
      ...missionView(mission, thread, viewOptions()),
      poll_url: `/v1/public/missions/${mission.mission_id}`,
      eta_seconds: options.eta_seconds,
      ...(options.note ? { note: options.note } : {}),
    });
  });

  app.get('/v1/public/missions/:missionId', { config: { rateLimit } }, async (req, reply) => {
    const principal = await requireApiKey(app, req, reply, 'missions:read'); if (!principal) return reply;
    const mission = await ctx().publicMissions.get(principal.tenantId, String(req.params.missionId));
    if (!mission || !collectiveAllowed(principal, mission.room_id)) return reply.code(404).send({ error: 'mission introuvable', code: 'mission_not_found' });
    const thread = mission.thread_id ? await ctx().hybridGateway.getThread(mission.thread_id, { tenantId: principal.tenantId }) : null;
    return missionView(mission, thread, viewOptions());
  });

  app.get('/v1/public/missions', { config: { rateLimit } }, async (req, reply) => {
    const principal = await requireApiKey(app, req, reply, 'missions:read'); if (!principal) return reply;
    const raw = req.query?.external_ref;
    const externalRef = raw ? parseExternalRef(String(raw)) : null;
    if (raw && !externalRef) return reply.code(400).send({ error: 'external_ref invalide (ex. salesforce:Opportunity:006…)', code: 'invalid_external_ref' });
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 20));
    const missions = (await ctx().publicMissions.search(principal.tenantId, { externalRef, limit }))
      .filter((mission) => collectiveAllowed(principal, mission.room_id));
    const views = await Promise.all(missions.map(async (mission) => missionView(
      mission, mission.thread_id ? await ctx().hybridGateway.getThread(mission.thread_id, { tenantId: principal.tenantId }) : null, viewOptions(),
    )));
    return { missions: views };
  });
}
