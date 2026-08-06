// KayrosLab backend — search tools registration from env.

export {
  ConfigurableWebSearch,
  buildSearchToolDefs,
  registerSearchTools,
  loadSearchConfigFromEnv,
} from '../../core/adapters/search-tools.mjs';

import { registerSearchTools, loadSearchConfigFromEnv } from '../../core/adapters/search-tools.mjs';

export function attachSearchTools(app, cfg = {}) {
  const registry = app?.kayrosContext?.tools;
  if (!registry) throw new Error('attachSearchTools: app.kayrosContext.tools manquant');
  const fromCtx = {
    googleApiKey: app.kayrosContext.GOOGLE_API_KEY,
    googleCx: app.kayrosContext.GOOGLE_CX,
    githubToken: app.kayrosContext.GITHUB_TOKEN,
    gitlabToken: app.kayrosContext.GITLAB_TOKEN,
    gitlabBaseUrl: app.kayrosContext.GITLAB_BASE_URL,
  };
  const merged = { ...loadSearchConfigFromEnv(), ...fromCtx, ...cfg };
  for (const k of Object.keys(merged)) {
    if (merged[k] === '') delete merged[k];
  }
  return registerSearchTools(registry, merged);
}
