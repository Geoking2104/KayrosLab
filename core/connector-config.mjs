import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { SlackAdapter, TeamsAdapter } from './connectors.mjs';
import { DiscordAdapter } from './connectors-discord.mjs';

const PLATFORMS = ['slack', 'discord', 'teams'];
const SECRET_FIELDS = {
  slack: ['bot_token', 'signing_secret', 'webhook_url'],
  discord: ['application_id', 'bot_token', 'public_key', 'webhook_url'],
  teams: ['app_id', 'bot_password', 'webhook_url'],
};

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function platformOf(value) {
  const platform = String(value || '').toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error(`plateforme inconnue: ${platform}`);
  return platform;
}

export function connectorEncryptionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new Error('KAYROS_CONNECTOR_ENCRYPTION_KEY doit être une clé base64 de 32 octets');
  return decoded;
}

export function encryptConnectorSecrets(secrets, key) {
  if (!key) throw new Error('stockage sécurisé indisponible: KAYROS_CONNECTOR_ENCRYPTION_KEY non configurée');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptConnectorSecrets(value, key) {
  if (!value) return {};
  if (!key) throw new Error('clé de chiffrement des connecteurs indisponible');
  const [version, ivValue, tagValue, ciphertextValue] = String(value).split('.');
  if (version !== 'v1' || !ciphertextValue) throw new Error('format de secret connecteur inconnu');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export class InMemoryConnectorConfigStore {
  constructor() { this.rows = new Map(); }
  _key(tenantId, platform) { return `${tenantId}:${platform}`; }
  async get(tenantId, platform) { return clone(this.rows.get(this._key(tenantId, platform)) || null); }
  async getByConnectionId(connectionId) { return clone([...this.rows.values()].find((row) => row.connection_id === connectionId) || null); }
  async list(tenantId) { return [...this.rows.values()].filter((row) => row.tenant_id === tenantId).map(clone); }
  async save(row) { this.rows.set(this._key(row.tenant_id, row.platform), clone(row)); return clone(row); }
}

export class PgConnectorConfigStore {
  constructor(pool) { this.pool = pool; }
  async get(tenantId, platform) {
    const { rows } = await this.pool.query('select * from kayros_connector_configurations where tenant_id=$1 and platform=$2', [tenantId, platform]);
    return rows[0] || null;
  }
  async getByConnectionId(connectionId) {
    const { rows } = await this.pool.query('select * from kayros_connector_configurations where connection_id=$1', [connectionId]);
    return rows[0] || null;
  }
  async list(tenantId) {
    const { rows } = await this.pool.query('select * from kayros_connector_configurations where tenant_id=$1 order by platform', [tenantId]);
    return rows;
  }
  async save(row) {
    const { rows } = await this.pool.query(
      `insert into kayros_connector_configurations
       (tenant_id, platform, connection_id, enabled, status, settings, encrypted_secrets,
        secret_fingerprint, last_tested_at, last_error, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
       on conflict (tenant_id, platform) do update set
         enabled=excluded.enabled, status=excluded.status, settings=excluded.settings,
         encrypted_secrets=excluded.encrypted_secrets, secret_fingerprint=excluded.secret_fingerprint,
         last_tested_at=excluded.last_tested_at, last_error=excluded.last_error, updated_at=excluded.updated_at
       returning *`,
      [row.tenant_id, row.platform, row.connection_id, row.enabled, row.status, JSON.stringify(row.settings || {}),
        row.encrypted_secrets, row.secret_fingerprint, row.last_tested_at, row.last_error, row.created_at, row.updated_at],
    );
    return rows[0];
  }
}

function requiredSecrets(platform, secrets) {
  const required = platform === 'slack' ? ['bot_token', 'signing_secret']
    : platform === 'discord' ? ['application_id', 'bot_token', 'public_key']
      : ['app_id', 'bot_password'];
  const missing = required.filter((key) => !String(secrets[key] || '').trim());
  if (missing.length) throw new Error(`identifiants manquants: ${missing.join(', ')}`);
}

export class ConnectorConfigurationService {
  constructor({ store = new InMemoryConnectorConfigStore(), encryptionKey = null, fetchImpl = globalThis.fetch, linkService = null, publicApiUrl = '' } = {}) {
    this.store = store;
    this.key = connectorEncryptionKey(encryptionKey);
    this.fetch = fetchImpl;
    this.linkService = linkService;
    this.publicApiUrl = String(publicApiUrl || '').replace(/\/$/, '');
  }

  _public(row) {
    if (!row) return null;
    const configuredFields = row.encrypted_secrets ? SECRET_FIELDS[row.platform] : [];
    return {
      platform: row.platform, connection_id: row.connection_id, enabled: !!row.enabled,
      status: row.status, settings: clone(row.settings || {}),
      configured_secret_fields: configuredFields,
      last_tested_at: row.last_tested_at || null, last_error: row.last_error || null,
      webhook_url: this.publicApiUrl ? `${this.publicApiUrl}/v1/connectors/${row.platform}/configured/${row.connection_id}` : null,
    };
  }

  async list(tenantId) {
    const existing = new Map((await this.store.list(String(tenantId))).map((row) => [row.platform, row]));
    return PLATFORMS.map((platform) => this._public(existing.get(platform)) || {
      platform, connection_id: null, enabled: false, status: 'not_configured', settings: {},
      configured_secret_fields: [], last_tested_at: null, last_error: null, webhook_url: null,
    });
  }

  async configure(tenantId, platformValue, { secrets = {}, settings = {}, enabled = true } = {}) {
    const tenant = String(tenantId || 'default');
    const platform = platformOf(platformValue);
    const current = await this.store.get(tenant, platform);
    const previousSecrets = current?.encrypted_secrets ? decryptConnectorSecrets(current.encrypted_secrets, this.key) : {};
    const mergedSecrets = { ...previousSecrets, ...Object.fromEntries(Object.entries(secrets).filter(([, value]) => String(value || '').trim())) };
    requiredSecrets(platform, mergedSecrets);
    const timestamp = now();
    const row = {
      tenant_id: tenant, platform, connection_id: current?.connection_id || randomUUID(),
      enabled: enabled === true, status: enabled === true ? 'configured' : 'disabled', settings: clone(settings),
      encrypted_secrets: encryptConnectorSecrets(mergedSecrets, this.key),
      secret_fingerprint: createHash('sha256').update(JSON.stringify(mergedSecrets)).digest('hex').slice(0, 16),
      last_tested_at: current?.last_tested_at || null, last_error: null,
      created_at: current?.created_at || timestamp, updated_at: timestamp,
    };
    return this._public(await this.store.save(row));
  }

  async setEnabled(tenantId, platformValue, enabled) {
    const platform = platformOf(platformValue);
    const row = await this.store.get(String(tenantId), platform);
    if (!row) throw new Error('connecteur non configuré');
    row.enabled = enabled === true;
    row.status = row.enabled ? (row.last_error ? 'error' : 'configured') : 'disabled';
    row.updated_at = now();
    return this._public(await this.store.save(row));
  }

  async _secrets(tenantId, platform) {
    const row = await this.store.get(String(tenantId), platformOf(platform));
    if (!row?.encrypted_secrets) throw new Error('connecteur non configuré');
    return { row, secrets: decryptConnectorSecrets(row.encrypted_secrets, this.key) };
  }

  async adapterFor(tenantId, platform) {
    const { row, secrets } = await this._secrets(tenantId, platform);
    if (!row.enabled) return null;
    if (row.platform === 'slack') return new SlackAdapter({ signingSecret: secrets.signing_secret, botToken: secrets.bot_token, webhookUrl: secrets.webhook_url, fetchImpl: this.fetch, linkService: this.linkService });
    if (row.platform === 'discord') return new DiscordAdapter({ applicationId: secrets.application_id, botToken: secrets.bot_token, publicKey: secrets.public_key, webhookUrl: secrets.webhook_url, fetchImpl: this.fetch, linkService: this.linkService });
    return new TeamsAdapter({ botId: secrets.app_id, botPassword: secrets.bot_password, webhookUrl: secrets.webhook_url, fetchImpl: this.fetch, linkService: this.linkService });
  }

  async connection(connectionId, platformValue) {
    const platform = platformOf(platformValue);
    const row = await this.store.getByConnectionId(String(connectionId));
    if (!row || row.platform !== platform || !row.enabled || !row.encrypted_secrets) {
      throw new Error('connexion active introuvable');
    }
    const secrets = decryptConnectorSecrets(row.encrypted_secrets, this.key);
    const adapter = await this.adapterFor(row.tenant_id, platform);
    return { row, secrets, adapter };
  }

  async test(tenantId, platformValue) {
    const platform = platformOf(platformValue);
    const { row, secrets } = await this._secrets(tenantId, platform);
    let ok = false; let detail = '';
    try {
      if (platform === 'slack') {
        const response = await this.fetch('https://slack.com/api/auth.test', { headers: { Authorization: `Bearer ${secrets.bot_token}` } });
        const body = await response.json().catch(() => ({})); ok = response.ok && body.ok === true; detail = body.error || body.team || '';
      } else if (platform === 'discord') {
        const response = await this.fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${secrets.bot_token}` } });
        const body = await response.json().catch(() => ({})); ok = response.ok && !!body.id; detail = body.message || body.username || '';
      } else {
        const response = await this.fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: secrets.app_id, client_secret: secrets.bot_password, scope: 'https://api.botframework.com/.default' }),
        });
        const body = await response.json().catch(() => ({})); ok = response.ok && !!body.access_token; detail = body.error_description || body.token_type || '';
      }
    } catch (error) { detail = error.message; }
    row.last_tested_at = now(); row.last_error = ok ? null : (detail || 'échec de connectivité');
    row.status = ok ? 'connected' : 'error'; row.updated_at = now();
    await this.store.save(row);
    return { ...this._public(row), ok, detail: ok ? detail : undefined };
  }
}
