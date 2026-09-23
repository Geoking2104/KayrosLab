export default async function healthRoute(app) {
  app.get('/health', async () => {
    const ctx = app.kayrosContext;
    return {
      ok: true,
      providers: Object.keys(ctx.providers),
      // Fournisseur LLM effectif : mistral/anthropic si la clé est là, sinon mock.
      llm: {
        provider: ctx.MISTRAL_API_KEY ? 'mistral' : (ctx.ANTHROPIC_API_KEY ? 'anthropic' : 'mock'),
        live: Boolean(ctx.MISTRAL_API_KEY || ctx.ANTHROPIC_API_KEY),
        model: ctx.MISTRAL_API_KEY ? ctx.MISTRAL_MODEL : ctx.ANTHROPIC_MODEL,
      },
      mistralConfigured: !!ctx.MISTRAL_API_KEY,
      model: ctx.ANTHROPIC_MODEL,
      embedModel: ctx.EMBED_MODEL,
      anthropicConfigured: !!ctx.ANTHROPIC_API_KEY,
      persistence: ctx.storeBackend,
      multiInstanceReady: ctx.storeBackend === 'postgres' && !!ctx.collaborationStore && !!ctx.swarmStore,
      sso: { oidc: Boolean(ctx.oidc?.enabled), issuer: ctx.oidc?.enabled ? ctx.oidc.issuer : undefined },
      smtp: {
        configured: Boolean(ctx.smtp?.enabled && ctx.contactMailer),
        host: ctx.smtp?.enabled ? ctx.smtp.host : undefined,
        from: ctx.smtp?.enabled ? ctx.smtp.from : undefined,
      },
    };
  });
}
