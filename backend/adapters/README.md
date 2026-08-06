# Backend adapters

## LangChain tools bridge

Optional peer: `@langchain/core`.

```bash
cd backend/fastify && npm install @langchain/core
```

```js
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { attachLangChainTools } from './langchain-tools.mjs';

const searchTool = new DynamicStructuredTool({
  name: 'search_web',
  description: 'Search the public web',
  schema: z.object({ q: z.string() }),
  func: async ({ q }) => ({ results: [`hit for ${q}`] }),
});

attachLangChainTools(app, [searchTool], {
  // sideEffect: 'read',
  // prefix: 'lc_',
});
```

## LangGraph runner

Optional peer: `@langchain/langgraph` (+ `@langchain/core`).

```bash
cd backend/fastify && npm install @langchain/langgraph @langchain/core
```

```js
import { attachResearchGraph } from './langgraph-runner.mjs';

await attachResearchGraph(app);

const result = await app.kayrosContext.runResearch({
  idea: 'Lancer une offre B2B souveraine',
  constraints: { market: 'EU' },
});
// { summary, signals, artifacts, warnings }
```

Without LangGraph installed, `createResearchGraph()` falls back to a **mock** graph with the same `.invoke()` contract.

Flow: **gather** → **synthesize** → Kayros maps to step output → human/auto gate remains in Orchestrator.

## Search tools

```bash
KAYROS_SEARCH_PROVIDER=auto   # auto | tavily | brave | google | duckduckgo
KAYROS_SEARCH_LIMIT=5
TAVILY_API_KEY=
BRAVE_API_KEY=
GOOGLE_API_KEY=
GOOGLE_CX=
GITHUB_TOKEN=
```

Registered at Fastify boot (`registerSearchToolsFromEnv`):

- `search_web` / `search_docs` / `search_competitors`
- `search_github` / `search_arxiv` / `search_all`

`auto` tries **Tavily → Brave → Google CSE → DuckDuckGo**.

## Langfuse (observability)

Optional peer: `langfuse`.

```bash
cd backend/fastify && npm install langfuse
```

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
# LANGFUSE_RELEASE=kayroslab-prod
```

```js
import { attachLangfuse } from './langfuse.mjs';

await attachLangfuse(app);
// wraps llm + tools when keys present; no-op otherwise
```

Spans: `llm.complete` (generation), `tool.<name>` (span).  
Metadata: `ideaId`, `stage`, `tenantId`, `userId`, `gateId`, `provider`.

Architecture: [docs/engine-architecture.md](../../docs/engine-architecture.md).
