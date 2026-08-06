// Called from buildContext to register multi-provider search tools.
import { registerSearchTools } from '../../../core/adapters/search-tools.mjs';

export function registerSearchToolsFromEnv(tools) {
  return registerSearchTools(tools, {
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    googleCx: process.env.GOOGLE_CX || '',
    braveApiKey: process.env.BRAVE_API_KEY || '',
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
    githubToken: process.env.GITHUB_TOKEN || '',
    preferredWebProvider: process.env.KAYROS_SEARCH_PROVIDER || 'auto',
    defaultLimit: Number(process.env.KAYROS_SEARCH_LIMIT || 5) || 5,
  });
}
