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
// → app.kayrosContext.researchGraph
// → app.kayrosContext.runResearch({ idea, constraints })

const result = await app.kayrosContext.runResearch({
  idea: 'Lancer une offre B2B souveraine',
  constraints: { market: 'EU' },
});
// { summary, signals, artifacts, warnings }
```

Without LangGraph installed, `createResearchGraph()` falls back to a **mock** graph with the same `.invoke()` contract (tests + offline).

Flow: **gather** (ToolRegistry search-like tools) → **synthesize** → Kayros maps to step output → human/auto gate remains in Orchestrator.
