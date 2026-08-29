import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  name: z.string().optional(),
  role: z.string().optional(),
  tenantId: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({ email: z.string().email().max(320) });
const resetPasswordSchema = z.object({
  token: z.string().min(20).max(4096),
  password: z.string().min(10).max(128),
});

const RESET_ACCEPTED = 'Si un compte correspond à cette adresse, un lien de réinitialisation lui a été envoyé.';

export default async function authRoutes(app) {
  app.post('/v1/auth/register', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { email, password, name, role, tenantId } = parsed.data;
    try {
      let asked = role || 'contributeur';
      if (asked !== 'contributeur') {
        const caller = await app.requireAuth(req, reply); if (!caller) return;
        if (caller.role !== 'comex') return reply.code(403).send({ error: 'seul un COMEX peut creer ce role' });
      }
      return { user: await ctx.auth.register({ email, password, name, role: asked, tenantId }) };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
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

  app.post('/v1/auth/password/forgot', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'adresse e-mail invalide' });
    const reset = await ctx.auth.createPasswordReset({
      email: parsed.data.email,
      ttlSec: ctx.passwordResetTtlSec || 1800,
    });
    if (reset && ctx.passwordResetMailer) {
      try { await ctx.passwordResetMailer.send({ email: reset.user.email, token: reset.token }); }
      catch (error) { req.log.error({ err: error }, 'password reset email failed'); }
    }
    return reply.code(202).send({ ok: true, message: RESET_ACCEPTED });
  });

  app.post('/v1/auth/password/reset', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.auth) return reply.code(503).send({ error: 'authentification non configuree' });
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'lien ou mot de passe invalide', issues: parsed.error.issues });
    try {
      await ctx.auth.resetPassword(parsed.data);
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
