import { llmBindings } from '../lib/context.mjs';
import { describeLlmConfig, resolveLlmConfig } from '../lib/llm-config.mjs';

export default async function healthRoute(app) {
  app.get('/health', async () => {
    const ctx = app.kayrosContext;
    // Contexte construit hors buildContext (tests) : on retombe sur l'env.
    const llmConfig = ctx.llmConfig || resolveLlmConfig(process.env);
    return {
      ok: true,
      providers: Object.keys(ctx.providers),
      // Fournisseur LLM effectif (LLM_PROVIDER > NVIDIA > Mistral > Anthropic > mock),
      // chaîne de repli et bornes 429. Aucune clé, seulement des booléens.
      llm: {
        ...describeLlmConfig(llmConfig),
        // Liaison par composant : tout `engine-local` signale un écart avec `provider` (ENF-09).
        components: llmBindings(ctx.engine, ctx.llm),
      },
      mistralConfigured: !!ctx.MISTRAL_API_KEY,
      nvidiaConfigured: !!llmConfig.configured?.nvidia,
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
