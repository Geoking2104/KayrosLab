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

// After Fastify app + kayrosContext is ready:
const searchTool = new DynamicStructuredTool({
  name: 'search_web',
  description: 'Search the public web',
  schema: z.object({ q: z.string() }),
  func: async ({ q }) => ({ results: [`hit for ${q}`] }),
});

attachLangChainTools(app, [searchTool], {
  // sideEffect: 'read',
  // prefix: 'lc_',
  // gate: false,
});

// Tools appear in GET /v1/tools and POST /v1/tools/call
```

Core API (no Fastify):

```js
import { demoTools } from '../../core/tool-registry.mjs';
import { registerLangChainTools } from '../../core/adapters/langchain-tools.mjs';

const reg = demoTools();
registerLangChainTools(reg, [searchTool]);
await reg.call('search_web', { q: 'KayrosLab' });
```

Write tools (`create`, `send`, `update`…) get `sideEffect: 'write'` and `gate: true` by default so the orchestrator can require human approval.
