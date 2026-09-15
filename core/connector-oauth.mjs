// KayrosLab — connexion « un bouton » des canaux externes (Slack, Discord, Teams).
//
// Le serveur détient les identifiants d'application (client id/secret, bot token)
// une seule fois ; chaque tenant n'a plus qu'à cliquer « Connecter ». Le retour du
// fournisseur est un callback public dont l'état (state) est à usage unique et
// expire : il permet de retrouver le tenant sans exposer de secret.

const PLATFORMS = ['slack', 'discord', 'teams'];

function platformOf(value) {
  const platform = String(value || '').toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error(`plateforme inconnue: ${platform}`);
  return platform;
}

export function oauthConfigFromEnv(env = process.env) {
  return {
    slack: {
      clientId: String(env.SLACK_CLIENT_ID || '').trim(),
      clientSecret: String(env.SLACK_CLIENT_SECRET || '').trim(),
      signingSecret: String(env.SLACK_SIGNING_SECRET || '').trim(),
      scopes: String(env.SLACK_OAUTH_SCOPES || 'app_mentions:read,chat:write,im:history,channels:history,groups:history').trim(),
    },
    discord: {
      clientId: String(env.DISCORD_CLIENT_ID || env.DISCORD_APPLICATION_ID || '').trim(),
      clientSecret: String(env.DISCORD_CLIENT_SECRET || '').trim(),
      botToken: String(env.DISCORD_BOT_TOKEN || '').trim(),
      publicKey: String(env.DISCORD_PUBLIC_KEY || '').trim(),
      permissions: String(env.DISCORD_INVITE_PERMISSIONS || '534723950656').trim(),
      scopes: String(env.DISCORD_OAUTH_SCOPES || 'bot applications.commands').trim(),
    },
    teams: {
      appId: String(env.TEAMS_APP_ID || '').trim(),
      botPassword: String(env.TEAMS_BOT_PASSWORD || '').trim(),
      tenant: String(env.TEAMS_OAUTH_TENANT || 'organizations').trim(),
    },
  };
}

/** Mode de connexion disponible sans saisie de secret côté utilisateur. */
export function connectorConnectionMode(platformValue, config = oauthConfigFromEnv()) {
  const platform = platformOf(platformValue);
  if (platform === 'slack') return (config.slack.clientId && config.slack.clientSecret) ? 'oauth' : null;
  if (platform === 'discord') return (config.discord.clientId && config.discord.botToken && config.discord.publicKey) ? 'invite' : null;
  return (config.teams.appId && config.teams.botPassword) ? 'admin_consent' : null;
}

export function buildAuthorizeUrl(platformValue, { config, redirectUri, state }) {
  const platform = platformOf(platformValue);
  if (!redirectUri) throw new Error('URL de retour du connecteur requise');
  if (!state) throw new Error('état OAuth requis');
  const url = new URL(
    platform === 'slack' ? 'https://slack.com/oauth/v2/authorize'
      : platform === 'discord' ? 'https://discord.com/oauth2/authorize'
        : `https://login.microsoftonline.com/${encodeURIComponent(config.teams.tenant)}/adminconsent`,
  );
  if (platform === 'slack') {
    url.searchParams.set('client_id', config.slack.clientId);
    url.searchParams.set('scope', config.slack.scopes);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
  } else if (platform === 'discord') {
    url.searchParams.set('client_id', config.discord.clientId);
    url.searchParams.set('scope', config.discord.scopes);
    url.searchParams.set('permissions', config.discord.permissions);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
  } else {
    url.searchParams.set('client_id', config.teams.appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
  }
  return url.toString();
}

export class ConnectorOAuthService {
  constructor({ config = oauthConfigFromEnv(), fetchImpl = globalThis.fetch, stateTtlMs = 600000, now = Date.now } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.stateTtlMs = stateTtlMs;
    this.now = now;
    this.states = new Map();
  }

  mode(platform) { return connectorConnectionMode(platform, this.config); }
  available(platform) { return this.mode(platform) !== null; }
  describe() { return PLATFORMS.map((platform) => ({ platform, mode: this.mode(platform), one_click: this.available(platform) })); }

  _purge() {
    const deadline = this.now();
    for (const [state, entry] of this.states) if (entry.expiresAt <= deadline) this.states.delete(state);
  }

  start(platformValue, { tenantId, redirectUri }) {
    const platform = platformOf(platformValue);
    if (!this.available(platform)) throw new Error(`connexion simplifiée indisponible pour ${platform}`);
    this._purge();
    const state = `${platform}_${Math.random().toString(36).slice(2)}${this.now().toString(36)}`;
    const expiresAt = this.now() + this.stateTtlMs;
    this.states.set(state, { platform, tenantId: String(tenantId || 'default'), redirectUri, expiresAt });
    return { platform, mode: this.mode(platform), state, url: buildAuthorizeUrl(platform, { config: this.config, redirectUri, state }) };
  }

  consume(state) {
    this._purge();
    const entry = this.states.get(String(state || ''));
    if (!entry) throw new Error('état de connexion invalide ou expiré');
    this.states.delete(String(state));
    return entry;
  }

  /** Échange le retour fournisseur contre des identifiants stockables. */
  async complete(platformValue, { state, query = {} }) {
    const platform = platformOf(platformValue);
    const entry = this.consume(state);
    if (entry.platform !== platform) throw new Error('état de connexion incohérent');
    if (platform === 'slack') {
      const code = String(query.code || '').trim();
      if (!code) throw new Error('Slack : code d’autorisation manquant');
      const response = await this.fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.slack.clientId,
          client_secret: this.config.slack.clientSecret,
          code,
          redirect_uri: entry.redirectUri,
        }).toString(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true) throw new Error(`Slack : échange refusé (${body.error || response.status})`);
      return {
        platform, tenantId: entry.tenantId,
        secrets: { bot_token: body.access_token, signing_secret: this.config.slack.signingSecret, webhook_url: '' },
        settings: { install: 'oauth', team_id: body.team?.id || null, team_name: body.team?.name || null },
      };
    }
    if (platform === 'discord') {
      return {
        platform, tenantId: entry.tenantId,
        secrets: { application_id: this.config.discord.clientId, bot_token: this.config.discord.botToken, public_key: this.config.discord.publicKey, webhook_url: '' },
        settings: { install: 'invite', guild_id: String(query.guild_id || '').trim() || null },
      };
    }
    return {
      platform, tenantId: entry.tenantId,
      secrets: { app_id: this.config.teams.appId, bot_password: this.config.teams.botPassword, webhook_url: '' },
      settings: { install: 'admin_consent', tenant_id: String(query.tenant || '').trim() || null },
    };
  }
}
