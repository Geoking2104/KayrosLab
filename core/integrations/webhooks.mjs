// KayrosLab — webhooks sortants signés (événements de mission).
//
// Signature à la Stripe : en-tête
//   X-Kayros-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${corps brut}`)>
// Le récepteur recalcule le HMAC sur le corps brut et refuse un horodatage
// de plus de 5 minutes (anti-rejeu). `X-Kayros-Event-Id` permet de dédoublonner
// une livraison rejouée.
//
// Livraison durable : chaque envoi est une ligne de la boîte d'envoi
// (`kayros_webhook_deliveries` en Postgres). Un échec est retenté avec un
// délai croissant (1 min, 5 min, 30 min, 2 h, 6 h : 6 tentatives au total)
// et survit donc à un redémarrage ou un déploiement.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const WEBHOOK_EVENTS = Object.freeze(['mission.completed', 'mission.failed', 'mission.arbitrated']);
export const SIGNATURE_HEADER = 'x-kayros-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Délais avant les tentatives 2 à 6 (ms). */
export const RETRY_SCHEDULE_MS = Object.freeze([60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3]);
export const MAX_DELIVERY_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`; }

export function generateWebhookSecret() { return `whsec_${randomBytes(24).toString('base64url')}`; }

export function computeSignature(secret, timestamp, body) {
  return createHmac('sha256', String(secret)).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/** Valeur de l'en-tête X-Kayros-Signature pour un corps brut (chaîne JSON). */
export function signPayload(secret, body, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/**
 * Vérifie un en-tête de signature. Renvoie `{ ok: true, timestamp }` ou
 * `{ ok: false, reason }`. Accepte plusieurs `v1=` (rotation de secret).
 */
export function verifySignature(secret, body, header, { toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) return { ok: false, reason: 'secret manquant' };
  const parts = String(header || '').split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v || '');
  if (!Number.isFinite(timestamp) || !signatures.length) return { ok: false, reason: 'en-tête de signature mal formé' };
  if (toleranceSeconds > 0 && Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'horodatage hors tolérance' };
  const expected = Buffer.from(computeSignature(secret, timestamp, body), 'hex');
  const ok = signatures.some((candidate) => {
    const buf = Buffer.from(candidate, 'hex');
    return buf.length === expected.length && timingSafeEqual(buf, expected);
  });
  return ok ? { ok: true, timestamp } : { ok: false, reason: 'signature invalide' };
}

function privateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:');
  return false;
}

/**
 * URL de rappel acceptable : https (http seulement si autorisé), pas
 * d'identifiants dans l'URL, pas d'hôte privé (SSRF) sauf autorisation
 * explicite (n8n joint en local : KAYROS_WEBHOOK_ALLOW_PRIVATE=true).
 */
export function validateCallbackUrl(raw, { allowHttp = false, allowPrivate = false } = {}) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw Object.assign(new Error('callback_url invalide'), { statusCode: 400 }); }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw Object.assign(new Error('callback_url doit être en https'), { statusCode: 400 });
  }
  if (url.username || url.password) throw Object.assign(new Error('callback_url ne doit pas contenir d’identifiants'), { statusCode: 400 });
  if (!allowPrivate && privateHost(url.hostname)) throw Object.assign(new Error('callback_url vers un hôte privé refusée'), { statusCode: 400 });
  return url.toString();
}

/** Délai avant la tentative suivante (null = abandon). */
export function nextRetryDelayMs(attempts) {
  return attempts >= MAX_DELIVERY_ATTEMPTS ? null : RETRY_SCHEDULE_MS[Math.max(0, attempts - 1)] ?? null;
}

// --- Réglages d'intégration par tenant (URL + secret de signature) --------

export class InMemoryIntegrationSettingsStore {
  constructor() { this.items = new Map(); }
  async get(tenantId) { return clone(this.items.get(String(tenantId)) || null); }
  async put(tenantId, settings) { this.items.set(String(tenantId), clone({ ...settings, tenant_id: String(tenantId) })); return this.get(tenantId); }
}

export class PgIntegrationSettingsStore {
  constructor(pool) { this.pool = pool; }
  async get(tenantId) {
    const { rows } = await this.pool.query('select * from kayros_integration_settings where tenant_id = $1', [String(tenantId)]);
    const row = rows[0];
    return row ? {
      tenant_id: row.tenant_id, webhook_url: row.webhook_url, webhook_secret: row.webhook_secret,
      events: row.events || [...WEBHOOK_EVENTS], enabled: row.enabled !== false,
      updated_by: row.updated_by, updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    } : null;
  }
  async put(tenantId, settings) {
    await this.pool.query(
      `insert into kayros_integration_settings (tenant_id, webhook_url, webhook_secret, events, enabled, updated_by, updated_at)
       values ($1,$2,$3,$4::text[],$5,$6,now())
       on conflict (tenant_id) do update set webhook_url = excluded.webhook_url, webhook_secret = excluded.webhook_secret,
         events = excluded.events, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
      [String(tenantId), settings.webhook_url || null, settings.webhook_secret || null,
        settings.events || [...WEBHOOK_EVENTS], settings.enabled !== false, settings.updated_by || null],
    );
    return this.get(tenantId);
  }
}

/**
 * Réglages chiffrés au repos : le secret HMAC doit rester lisible (on signe
 * avec), il est donc chiffré (AES-256-GCM, clé des connecteurs) plutôt que haché.
 */
export class IntegrationSettingsService {
  constructor({ store = new InMemoryIntegrationSettingsStore(), encrypt = null, decrypt = null } = {}) {
    this.store = store;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
  }
  _seal(secret) { return secret && this.encrypt ? `enc:${this.encrypt(secret)}` : secret; }
  _open(value) {
    if (!value) return null;
    if (String(value).startsWith('enc:')) {
      // Clé de chiffrement absente ou changée : secret illisible, il faudra le régénérer.
      try { return this.decrypt ? this.decrypt(String(value).slice(4)) : null; } catch { return null; }
    }
    return value;
  }
  async get(tenantId) {
    const record = await this.store.get(tenantId);
    if (!record) return { tenant_id: String(tenantId), webhook_url: null, webhook_secret: null, events: [...WEBHOOK_EVENTS], enabled: true };
    return { ...record, webhook_secret: this._open(record.webhook_secret) };
  }
  /** Vue console : jamais le secret, seulement sa présence. */
  async view(tenantId) {
    const settings = await this.get(tenantId);
    return {
      webhook_url: settings.webhook_url || null, events: settings.events || [...WEBHOOK_EVENTS],
      enabled: settings.enabled !== false, has_secret: !!settings.webhook_secret,
      secret_hint: settings.webhook_secret ? `${settings.webhook_secret.slice(0, 9)}…${settings.webhook_secret.slice(-4)}` : null,
      updated_by: settings.updated_by || null, updated_at: settings.updated_at || null,
    };
  }
  /** Garantit un secret de signature (créé au premier besoin). */
  async ensureSecret(tenantId, { by = null } = {}) {
    const settings = await this.get(tenantId);
    if (settings.webhook_secret) return settings.webhook_secret;
    const secret = generateWebhookSecret();
    await this.store.put(tenantId, { ...settings, webhook_secret: this._seal(secret), updated_by: by });
    return secret;
  }
  async update(tenantId, { webhook_url, events, enabled, rotate_secret = false } = {}, { by = null } = {}) {
    const current = await this.get(tenantId);
    const secret = rotate_secret || !current.webhook_secret ? generateWebhookSecret() : current.webhook_secret;
    const next = {
      webhook_url: webhook_url === undefined ? current.webhook_url : (webhook_url || null),
      events: Array.isArray(events) && events.length ? events.filter((e) => WEBHOOK_EVENTS.includes(e)) : (current.events || [...WEBHOOK_EVENTS]),
      enabled: enabled === undefined ? current.enabled !== false : enabled === true,
      webhook_secret: this._seal(secret), updated_by: by,
    };
    await this.store.put(tenantId, next);
    return { settings: await this.view(tenantId), secret: secret !== current.webhook_secret ? secret : null };
  }
}

// --- Boîte d'envoi -------------------------------------------------------------

export class InMemoryWebhookOutbox {
  constructor() { this.items = new Map(); }
  async enqueue(delivery) {
    for (const item of this.items.values()) {
      if (item.event_id === delivery.event_id && item.target_url === delivery.target_url) return clone(item);
    }
    const record = { status: 'pending', attempts: 0, next_attempt_at: now(), created_at: now(), last_status: null, last_error: null, delivered_at: null, ...clone(delivery) };
    this.items.set(record.delivery_id, record);
    return clone(record);
  }
  async claimDue({ workerId, limit = 10, leaseMs = 60000 } = {}) {
    const t = Date.now();
    const due = [...this.items.values()]
      .filter((item) => (item.status === 'pending' && Date.parse(item.next_attempt_at) <= t)
        || (item.status === 'delivering' && Date.parse(item.lease_until || 0) < t))
      .sort((a, b) => String(a.next_attempt_at).localeCompare(String(b.next_attempt_at))).slice(0, limit);
    for (const item of due) { item.status = 'delivering'; item.locked_by = workerId; item.lease_until = new Date(t + leaseMs).toISOString(); }
    return due.map(clone);
  }
  async markDelivered(id, { status }) {
    const item = this.items.get(id); if (!item) return;
    Object.assign(item, { status: 'delivered', attempts: item.attempts + 1, last_status: status, last_error: null, delivered_at: now(), locked_by: null, lease_until: null });
  }
  async markFailed(id, { status = null, error = null, nextAttemptAt = null }) {
    const item = this.items.get(id); if (!item) return;
    Object.assign(item, {
      status: nextAttemptAt ? 'pending' : 'failed', attempts: item.attempts + 1, last_status: status,
      last_error: error, next_attempt_at: nextAttemptAt || item.next_attempt_at, locked_by: null, lease_until: null,
    });
  }
  async list(tenantId, { limit = 50 } = {}) {
    return [...this.items.values()].filter((item) => item.tenant_id === tenantId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit).map(clone);
  }
}

export class PgWebhookOutbox {
  constructor(pool) { this.pool = pool; }
  static row(row) {
    if (!row) return null;
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    return {
      delivery_id: row.delivery_id, tenant_id: row.tenant_id, event_id: row.event_id, event_type: row.event_type,
      mission_id: row.mission_id, target_url: row.target_url, payload: row.payload, status: row.status,
      attempts: Number(row.attempts || 0), next_attempt_at: iso(row.next_attempt_at), last_status: row.last_status,
      last_error: row.last_error, created_at: iso(row.created_at), delivered_at: iso(row.delivered_at),
    };
  }
  async enqueue(delivery) {
    const { rows } = await this.pool.query(
      `insert into kayros_webhook_deliveries (delivery_id, tenant_id, event_id, event_type, mission_id, target_url, payload)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)
       on conflict (event_id, target_url) do update set event_id = excluded.event_id
       returning *`,
      [delivery.delivery_id, delivery.tenant_id, delivery.event_id, delivery.event_type, delivery.mission_id || null,
        delivery.target_url, JSON.stringify(delivery.payload)],
    );
    return PgWebhookOutbox.row(rows[0]);
  }
  async claimDue({ workerId, limit = 10, leaseMs = 60000 } = {}) {
    const { rows } = await this.pool.query(
      `update kayros_webhook_deliveries d set status = 'delivering', locked_by = $1,
         lease_until = now() + ($3 * interval '1 millisecond')
       where d.delivery_id in (
         select delivery_id from kayros_webhook_deliveries
         where (status = 'pending' and next_attempt_at <= now())
            or (status = 'delivering' and lease_until < now())
         order by next_attempt_at asc
         for update skip locked
         limit $2)
       returning d.*`,
      [workerId, limit, leaseMs],
    );
    return rows.map(PgWebhookOutbox.row);
  }
  async markDelivered(id, { status }) {
    await this.pool.query(
      `update kayros_webhook_deliveries set status = 'delivered', attempts = attempts + 1, last_status = $2,
         last_error = null, delivered_at = now(), locked_by = null, lease_until = null where delivery_id = $1`,
      [id, status],
    );
  }
  async markFailed(id, { status = null, error = null, nextAttemptAt = null }) {
    await this.pool.query(
      `update kayros_webhook_deliveries set status = case when $4::timestamptz is null then 'failed' else 'pending' end,
         attempts = attempts + 1, last_status = $2, last_error = $3,
         next_attempt_at = coalesce($4::timestamptz, next_attempt_at), locked_by = null, lease_until = null
       where delivery_id = $1`,
      [id, status, error ? String(error).slice(0, 500) : null, nextAttemptAt],
    );
  }
  async list(tenantId, { limit = 50 } = {}) {
    const { rows } = await this.pool.query(
      'select * from kayros_webhook_deliveries where tenant_id = $1 order by created_at desc limit $2',
      [String(tenantId), Math.max(1, Math.min(200, Number(limit) || 50))],
    );
    return rows.map(PgWebhookOutbox.row);
  }
}

/**
 * Envoie les livraisons dues. `deliverDue()` est appelable à la main (tests) ;
 * `start()` lance une boucle légère (une requête toutes les `intervalMs`).
 */
export class WebhookDispatcher {
  constructor({ outbox = new InMemoryWebhookOutbox(), settings, fetchImpl = null, timeoutMs = 10000, intervalMs = 5000, logger = console, workerId = `wh_${process.pid}`, userAgent = 'KayrosLab-Webhooks/1.0', onResult = null } = {}) {
    if (!settings) throw new Error('WebhookDispatcher: settings requis');
    this.outbox = outbox;
    this.settings = settings;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.workerId = workerId;
    this.userAgent = userAgent;
    this.onResult = onResult;
    this.timer = null;
    this.running = null;
  }

  /** Met un événement en file pour chaque cible ; renvoie les livraisons créées. */
  async enqueue({ tenantId, event, missionId = null, targets = [] }) {
    const unique = [...new Set(targets.filter(Boolean))];
    const deliveries = [];
    for (const target_url of unique) {
      deliveries.push(await this.outbox.enqueue({
        delivery_id: makeId('whd'), tenant_id: String(tenantId), event_id: event.event_id,
        event_type: event.event, mission_id: missionId, target_url, payload: event,
      }));
    }
    if (deliveries.length) this.kick();
    return deliveries;
  }

  kick() { if (this.timer) setImmediate(() => this.deliverDue().catch(() => {})); }

  async _send(delivery) {
    const secret = await this.settings.ensureSecret(delivery.tenant_id);
    const body = JSON.stringify(delivery.payload);
    const f = this.fetch || globalThis.fetch;
    const res = await f(delivery.target_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'user-agent': this.userAgent,
        'x-kayros-signature': signPayload(secret, body),
        'x-kayros-event': delivery.event_type, 'x-kayros-event-id': delivery.event_id,
        'x-kayros-delivery': delivery.delivery_id, 'x-kayros-attempt': String((delivery.attempts || 0) + 1),
      },
      body,
      redirect: 'manual',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    return res.status;
  }

  async deliverDue({ limit = 10 } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      let processed = 0;
      const batch = await this.outbox.claimDue({ workerId: this.workerId, limit, leaseMs: this.timeoutMs * 3 });
      for (const delivery of batch) {
        processed += 1;
        let status = null; let error = null;
        try { status = await this._send(delivery); } catch (e) { error = e?.name === 'TimeoutError' ? 'délai dépassé' : (e?.message || String(e)); }
        const ok = status != null && status >= 200 && status < 300;
        if (ok) await this.outbox.markDelivered(delivery.delivery_id, { status });
        else {
          const delay = nextRetryDelayMs((delivery.attempts || 0) + 1);
          // 410 Gone : le récepteur refuse définitivement (ex. exécution n8n déjà reprise).
          const final = status === 410 || delay == null;
          await this.outbox.markFailed(delivery.delivery_id, {
            status, error: error || `HTTP ${status}`,
            nextAttemptAt: final ? null : new Date(Date.now() + delay).toISOString(),
          });
        }
        try { this.onResult?.({ delivery, ok, status, error }); } catch { /* métriques facultatives */ }
      }
      return processed;
    })();
    try { return await this.running; } finally { this.running = null; }
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.deliverDue().catch((e) => this.logger?.warn?.('[kayros][webhooks]', e?.message || e)), this.intervalMs);
    this.timer.unref?.();
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
