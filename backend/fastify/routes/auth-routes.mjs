import { z } from 'zod';
import { syncAutheliaUser } from '../lib/authelia-sync.mjs';
import { workspaceStoreFor } from '../lib/workspace-roles.mjs';
import { inviteTokenHash } from './console-workspace.mjs';
import {
  authorizeUrl,
  exchangeAuthorizationCode,
  fetchJwks,
  isAllowedRedirect,
  loadDiscovery,
  publicAuthProviders,
  verifyIdToken,
} from '../lib/oidc.mjs';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  name: z.string().optional(),
  role: z.string().optional(),
  // Accepté pour compatibilité des anciens clients mais JAMAIS utilisé : le tenant
  // est fixé côté serveur (EF-25 / ENF-08).
  tenantId: z.string().optional(),
});

// Tenant d'inscription libre-service tant que Q3 (tenant dédié par utilisateur)
// n'est pas tranchée : l'isolation entre comptes se fait par propriétaire.
const SELF_SERVICE_TENANT = 'default';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({ email: z.string().email().max(320) });
const resetPasswordSchema = z.object({
  token: z.string().min(20).max(4096),
  password: z.string().min(10).max(128),
});

const ssoStartSchema = z.object({
  provider: z.enum(['oidc', 'google']).default('oidc'),
  redirectUri: z.string().url(),
  state: z.string().min(8).max(256),
  challenge: z.string().min(16).max(256),
  nonce: z.string().min(8).max(256),
});

const ssoCallbackSchema = z.object({
  provider: z.enum(['oidc', 'google']).default('oidc'),
  code: z.string().min(1).max(4096),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url(),
  nonce: z.string().min(8).max(256),
});

const RESET_ACCEPTED = 'Demande prise en compte. Si un compte correspond à cette adresse, vous recevrez un lien de réinitialisation. Vérifiez aussi vos courriers indésirables.';
const RESET_UNAVAILABLE = 'L’envoi des e-mails de réinitialisation est temporairement indisponible. Réessayez plus tard ou utilisez votre connexion Google habituelle.';

async function resolvedOidc(ctx, provider = 'oidc') {
  if (provider === 'google') {
    if (!ctx.googleDiscovered) ctx.googleDiscovered = await loadDiscovery(ctx.google, { fetchImpl: ctx.googleFetch || fetch });
    return ctx.googleDiscovered;
  }
  if (ctx.oidcDiscovered) return ctx.oidcDiscovered;
  if (ctx.oidcDiscovery) {
    const doc = ctx.oidcDiscovery;
    ctx.oidcDiscovered = {
      ...ctx.oidc,
      issuer: String(doc.issuer || ctx.oidc.issuer).replace(/\/$/, ''),
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwksUri: doc.jwks_uri,
    };
    return ctx.oidcDiscovered;
  }
  ctx.oidcDiscovered = await loadDiscovery(ctx.oidc, { fetchImpl: ctx.oidcFetch || fetch });
  return ctx.oidcDiscovered;
}

async function pushAuthelia(req, payload) {
  try {
    const sync = await syncAutheliaUser(payload);
    if (sync?.username) req.log.info({ username: sync.username }, 'authelia sync');
  } catch (error) {
    req.log.error({ err: error }, 'authelia sync failed');
  }
}

export default async function authRoutes(app) {
  app.post('/v1/auth/register', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { email, password, name, role } = parsed.data;
    if (parsed.data.tenantId !== undefined) req.log.warn({ email }, 'register: tenantId fourni par le client ignore');
    try {
      let asked = role || 'contributeur';
      let tenantId = SELF_SERVICE_TENANT;
      if (asked !== 'contributeur') {
        const caller = await app.requireAuth(req, reply); if (!caller) return;
        if (caller.role !== 'comex') return reply.code(403).send({ error: 'seul un COMEX peut creer ce role' });
        // Un COMEX crée un compte privilégié dans SON tenant, jamais dans un autre.
        tenantId = caller.tenantId || SELF_SERVICE_TENANT;
      }
      const user = await ctx.auth.register({ email, password, name, role: asked, tenantId });
      await pushAuthelia(req, { email, password, name: name || user?.name });
      return { user };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  // --- Activation d'une invitation (console → Membres → Inviter) ---------
  // Le lien reçu par e-mail porte un jeton à usage unique : il crée le compte
  // DANS l'espace de l'invitant (et non dans l'espace libre-service), ou
  // rattache un compte existant du même espace, puis ouvre la session.
  const findInvite = async (token) => {
    const hash = inviteTokenHash(token);
    if (!token || String(token).length < 16) return null;
    const found = await workspaceStoreFor(app.kayrosContext).findAcross('members', (m) => m.status === 'invited' && m.invite_token_sha256 === hash);
    if (!found) return null;
    if (found.item.invite_expires_at && Date.parse(found.item.invite_expires_at) < Date.now()) return { ...found, expired: true };
    return found;
  };
  app.get('/v1/auth/invite/:token', async (req, reply) => {
    const found = await findInvite(req.params.token);
    if (!found) return reply.code(404).send({ error: 'invitation introuvable ou déjà utilisée', code: 'invite_not_found' });
    if (found.expired) return reply.code(410).send({ error: 'invitation expirée : demandez une nouvelle invitation', code: 'invite_expired' });
    const account = await app.kayrosContext.userStore?.findByEmail?.(found.item.email).catch(() => null);
    return { email: found.item.email, name: found.item.name || '', role: found.item.role, invited_by: found.item.invited_by || null, account_exists: !!account };
  });
  const acceptSchema = z.object({ token: z.string().min(16).max(200), password: z.string().min(8).max(200), name: z.string().max(200).optional() });
  app.post('/v1/auth/invite/accept', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = acceptSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'mot de passe de 8 caractères minimum requis', issues: parsed.error.issues });
    const found = await findInvite(parsed.data.token);
    if (!found) return reply.code(404).send({ error: 'invitation introuvable ou déjà utilisée', code: 'invite_not_found' });
    if (found.expired) return reply.code(410).send({ error: 'invitation expirée : demandez une nouvelle invitation', code: 'invite_expired' });
    const { tenantId, item: member } = found;
    const existing = await ctx.userStore?.findByEmail?.(member.email).catch(() => null);
    if (existing && String(existing.tenantId || 'default') !== tenantId) {
      return reply.code(409).send({ error: 'un compte existe déjà avec cette adresse dans un autre espace : contactez l’administrateur', code: 'account_other_tenant' });
    }
    let session;
    try {
      if (!existing) {
        // Rôle du compte : comex pour les gestionnaires, sinon contributeur ; la fiche membre fixe le rôle effectif (lecteur compris).
        const accountRole = ['comex', 'admin'].includes(member.role) ? 'comex' : 'contributeur';
        await ctx.auth.register({ email: member.email, password: parsed.data.password, name: parsed.data.name || member.name || null, role: accountRole, tenantId });
        await pushAuthelia(req, { email: member.email, password: parsed.data.password, name: parsed.data.name || member.name });
      }
      // Compte existant : le mot de passe saisi doit être le sien (connexion classique).
      session = await ctx.auth.login({ email: member.email, password: parsed.data.password, throttleKey: `${member.email}|${req.ip}` });
    } catch (e) {
      if (e.code === 'AUTH_THROTTLED') return reply.code(429).send({ error: e.message });
      return reply.code(existing ? 401 : 400).send({ error: existing ? 'compte existant : saisissez son mot de passe actuel' : e.message });
    }
    await workspaceStoreFor(ctx).update(tenantId, 'members', member.id, { status: 'active', joined_at: new Date().toISOString(), invite_token_sha256: null, account_created: !existing });
    return { ...session, activated: true, account_created: !existing };
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'email et password requis', issues: parsed.error.issues });
    const { email, password } = parsed.data;
    try {
      return await ctx.auth.login({ email, password, throttleKey: `${email.toLowerCase()}|${req.ip}` });
    } catch (e) {
      if (e.code === 'AUTH_THROTTLED') return reply.code(429).send({ error: e.message });
      return reply.code(401).send({ error: e.message });
    }
  });

  app.get('/v1/auth/sso', async () => publicAuthProviders(app.kayrosContext.oidc, app.kayrosContext.google));

  app.post('/v1/auth/sso/start', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const ctx = app.kayrosContext;
    const parsed = ssoStartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'requete SSO invalide' });
    if (!ctx[parsed.data.provider]?.enabled) return reply.code(503).send({ error: 'Fournisseur de connexion non configuré' });
    if (!isAllowedRedirect(parsed.data.redirectUri, ctx.consoleUrl)) {
      return reply.code(400).send({ error: 'redirect_uri SSO refusé' });
    }
    try {
      const oidc = await resolvedOidc(ctx, parsed.data.provider);
      return { url: authorizeUrl(oidc, parsed.data) };
    } catch (e) {
      return reply.code(503).send({ error: e.message });
    }
  });

  app.post('/v1/auth/sso/callback', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = ssoCallbackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'callback SSO invalide' });
    if (!ctx[parsed.data.provider]?.enabled) return reply.code(503).send({ error: 'Fournisseur de connexion non configuré' });
    if (!isAllowedRedirect(parsed.data.redirectUri, ctx.consoleUrl)) {
      return reply.code(400).send({ error: 'redirect_uri SSO refusé' });
    }
    try {
      const provider = parsed.data.provider;
      const fetchImpl = ctx[`${provider}Fetch`] || fetch;
      const oidc = await resolvedOidc(ctx, provider);
      const tokens = await exchangeAuthorizationCode(oidc, { ...parsed.data, fetchImpl });
      const jwks = ctx[`${provider}Jwks`] || await fetchJwks(oidc.jwksUri, { fetchImpl });
      const identity = verifyIdToken(tokens.id_token, {
        issuer: oidc.issuer,
        audience: oidc.audience || oidc.clientId,
        jwks,
        nonce: parsed.data.nonce,
      });
      if (identity.email_verified !== true) {
        return reply.code(403).send({ error: 'adresse e-mail SSO non vérifiée' });
      }
      const email = identity.email;
      return await ctx.auth.loginWithFederated({
        email,
        name: identity.name || identity.nickname || null,
        issuer: oidc.issuer,
        subject: identity.sub,
      });
    } catch (e) {
      if (e.code === 'OIDC_EMAIL') return reply.code(400).send({ error: e.message });
      if (e.code === 'OIDC_EXCHANGE' || e.code === 'OIDC_TOKEN' || e.code === 'OIDC_DISCOVERY') {
        return reply.code(401).send({ error: e.message });
      }
      return reply.code(401).send({ error: e.message });
    }
  });

  app.post('/v1/auth/password/forgot', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'adresse e-mail invalide' });
    // Check the same transport BEFORE looking up the account: an SMTP outage
    // must not return success, nor disclose whether an address is registered.
    if (!ctx.passwordResetMailer) return reply.code(503).send({ error: RESET_UNAVAILABLE });
    try { await ctx.passwordResetMailer.verify(); }
    catch (error) {
      req.log.error({ code: error.code }, 'password reset SMTP unavailable');
      return reply.code(503).send({ error: RESET_UNAVAILABLE });
    }
    const reset = await ctx.auth.createPasswordReset({
      email: parsed.data.email,
      ttlSec: ctx.passwordResetTtlSec || 1800,
    });
    if (reset) {
      try { await ctx.passwordResetMailer.send({ email: reset.user.email, token: reset.token }); }
      // A recipient-specific rejection must not expose account membership.
      // Acknowledging the request does not claim that the email was delivered.
      catch (error) { req.log.error({ code: error.code }, 'password reset email failed'); }
    }
    return reply.code(202).send({ ok: true, message: RESET_ACCEPTED });
  });

  app.post('/v1/auth/password/reset', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'lien ou mot de passe invalide', issues: parsed.error.issues });
    try {
      const result = await ctx.auth.resetPassword(parsed.data);
      const email = result?.user?.email || result?.email;
      if (email) await pushAuthelia(req, { email, password: parsed.data.password, name: result?.user?.name });
      return { ok: true, message: 'Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter.' };
    } catch (error) {
      if (error.code === 'AUTH_RESET_INVALID') return reply.code(400).send({ error: error.message });
      return reply.code(400).send({ error: error.message });
    }
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    await app.kayrosContext.auth.logout((req.headers.authorization || '').slice(7));
    return { ok: true };
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId } };
  });
}
