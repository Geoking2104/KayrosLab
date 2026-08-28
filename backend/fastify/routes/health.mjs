export default async function healthRoute(app) {
  app.get('/health', async () => {
    const ctx = app.kayrosContext;
    return {
      ok: true,
      providers: Object.keys(ctx.providers),
      model: ctx.ANTHROPIC_MODEL,
      embedModel: ctx.EMBED_MODEL,
      anthropicConfigured: !!ctx.ANTHROPIC_API_KEY,
      persistence: ctx.storeBackend,
      multiInstanceReady: ctx.storeBackend === 'postgres' && !!ctx.collaborationStore && !!ctx.swarmStore,
    };
  });
}
