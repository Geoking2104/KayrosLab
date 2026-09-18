import {
  authorizeUrl,
  configuredX,
  createXClient,
  ENGAGEMENTS,
  hashWrite,
  mentionMatches,
  MIN_WRITE_MS,
  openSeal,
  pkceChallenge,
  publicBinding,
  randomToken,
  seal,
  SalonXStore,
} from '../lib/salon-x.mjs';

const READ = ['tweet.read', 'users.read', 'offline.access'];
const WRITE = ['tweet.read', 'users.read', 'tweet.write', 'offline.access'];

function scopesOf(list) {
  const wanted = Array.isArray(list) ? list.map(String) : [];
  if (wanted.includes('tweet.write')) return WRITE;
  return READ;
}

export default async function salonXRoutes(app) {
  const store = () => {
    const ctx = app.kayrosContext;
    if (!ctx.salonX) {
      ctx.salonX = new SalonXStore({
        dir: process.env.KAYROS_SALON_X_DIR || null,
      });
    }
    return ctx.salonX;
  };
  const client = () => app.kayrosContext.xClient || createXClient();

  app.post('/v1/salon/x/oauth/start', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    if (!configuredX()) return reply.code(503).send({ error: 'X_CLIENT_ID manquant' });
    const redirectUri = String(req.body?.redirectUri || process.env.X_OAUTH_REDIRECT || 'https://www.kayroslab.com/salon/flux/callback').slice(0, 300);
    if (!/^https?:\/\/.+\/salon\/flux\/callback\/?$/.test(redirectUri)) {
      return reply.code(400).send({ error: 'redirect_uri hors pupitre' });
    }
    const scopes = scopesOf(req.body?.scopes);
    const state = randomToken(16);
    const verifier = randomToken(48);
    const challenge = pkceChallenge(verifier);
    store().putPending(state, { userId: me.sub, verifier, redirectUri, scopes });
    return { url: authorizeUrl({ state, challenge, redirectUri, scopes }) };
  });

  app.post('/v1/salon/x/oauth/callback', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const code = String(req.body?.code || '');
    const state = String(req.body?.state || '');
    const pending = store().takePending(state);
    if (!code || !pending || pending.userId !== me.sub) {
      return reply.code(400).send({ error: 'callback X invalide' });
    }
    try {
      const tokens = await client().exchangeCode({
        code,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
      });
      const meX = await client().me(tokens.access_token);
      const user = meX.data || {};
      const binding = {
        xUserId: String(user.id || ''),
        handle: String(user.username || ''),
        name: String(user.name || user.username || ''),
        scopes: pending.scopes,
        engagement: 'off',
        linkedAt: new Date().toISOString(),
        accessSealed: seal(tokens.access_token),
        refreshSealed: seal(tokens.refresh_token || ''),
      };
      await store().putBinding(me.sub, binding);
      return { binding: publicBinding(binding) };
    } catch (err) {
      return reply.code(err.status && err.status < 500 ? err.status : 502).send({ error: err.message || 'échange X refusé' });
    }
  });

  app.get('/v1/salon/x/binding', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const binding = await store().getBinding(me.sub);
    return { binding: publicBinding(binding) };
  });

  app.patch('/v1/salon/x/binding', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const binding = await store().getBinding(me.sub);
    if (!binding) return reply.code(404).send({ error: 'compte X non lié' });
    const engagement = req.body?.engagement;
    if (engagement && !ENGAGEMENTS.has(engagement)) {
      return reply.code(400).send({ error: 'engagement inconnu' });
    }
    if (engagement) binding.engagement = engagement;
    await store().putBinding(me.sub, binding);
    return { binding: publicBinding(binding) };
  });

  app.delete('/v1/salon/x/binding', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const binding = await store().getBinding(me.sub);
    if (binding?.refreshSealed) {
      try { await client().revoke(openSeal(binding.refreshSealed)); } catch { /* */ }
    }
    await store().deleteBinding(me.sub);
    return { ok: true };
  });

  app.post('/v1/salon/x/tweets', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const binding = await store().getBinding(me.sub);
    if (!binding?.handle) return reply.code(403).send({ error: 'compte X non lié' });
    if (!binding.scopes?.includes('tweet.write')) {
      return reply.code(403).send({ error: 'écriture X non autorisée' });
    }
    const text = String(req.body?.text || '').trim();
    const replyTo = String(req.body?.in_reply_to_tweet_id || '');
    if (!text || text.length > 4000) return reply.code(400).send({ error: 'texte invalide' });
    if (!/^\d{5,19}$/.test(replyTo)) return reply.code(400).send({ error: 'in_reply_to_tweet_id requis' });

    const hash = hashWrite(me.sub, text, replyTo);
    const again = await store().findByHash(me.sub, hash);
    if (again) return { id: again.id, idempotent: true };

    const elapsed = Date.now() - store().lastWrite(me.sub);
    if (elapsed < MIN_WRITE_MS) {
      return reply.code(429).send({ error: 'délai minimal de 45 s entre deux publications.' });
    }

    const access = openSeal(binding.accessSealed);
    try {
      const source = await client().getTweet(access, replyTo);
      const sourceText = source.data?.text || '';
      if (!mentionMatches(sourceText, binding.handle)) {
        return reply.code(403).send({ error: 'API reply refusée : le compte de l’hôte n’est pas convoqué sur ce post.' });
      }
      const posted = await client().postTweet(access, {
        text,
        reply: { in_reply_to_tweet_id: replyTo },
      });
      const id = posted.data?.id;
      if (!id) return reply.code(502).send({ error: 'X sans identifiant' });
      store().touchWrite(me.sub);
      await store().recordTweet(me.sub, {
        id,
        hash,
        replyTo,
        propositionId: String(req.body?.propositionId || '').slice(0, 80),
        createdAt: new Date().toISOString(),
      });
      return { id };
    } catch (err) {
      return reply.code(err.status && err.status < 500 ? err.status : 502).send({ error: err.message || 'publication X refusée' });
    }
  });

  app.delete('/v1/salon/x/tweets/:id', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const id = String(req.params.id || '');
    const mine = await store().findTweet(me.sub, id);
    if (!mine) return reply.code(404).send({ error: 'tweet Salon introuvable' });
    const age = Date.now() - Date.parse(mine.createdAt || 0);
    if (Number.isFinite(age) && age > 24 * 3600 * 1000) {
      return reply.code(403).send({ error: 'délai de retrait dépassé' });
    }
    const binding = await store().getBinding(me.sub);
    try {
      if (binding?.accessSealed) await client().deleteTweet(openSeal(binding.accessSealed), id);
    } catch (err) {
      return reply.code(502).send({ error: err.message || 'retrait X refusé' });
    }
    await store().dropTweet(me.sub, id);
    return { ok: true };
  });
}
