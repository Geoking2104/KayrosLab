# Changelog

## v0.16.x (2026-08) — Adapters & observability periphery

### Added
- **`core/adapters/langchain-tools.mjs`** — Bridge LangChain tools → `ToolRegistry` (`toKayrosTool`, `registerLangChainTools`, `fromAsyncFn`). Write tools default to `gate: true`.
- **`core/adapters/langgraph-runner.mjs`** — Research graph scaffold (`gather` → `synthesize`); mock fallback when `@langchain/langgraph` is absent. `runLangGraphStep` maps state → `{ summary, signals, artifacts }`.
- **`core/adapters/search-tools.mjs`** — Multi-provider web search (Tavily / Brave / Google CSE / DuckDuckGo) + GitHub + ArXiv + `search_all`. Registered at Fastify boot via `registerSearchToolsFromEnv`.
- **`core/adapters/langfuse.mjs`** — Optional LLM/tool tracing; **no-op** without API keys or SDK. Metadata: `ideaId`, `stage`, `tenantId`, `gateId`.
- **`backend/adapters/`** — Fastify attach helpers + [README](backend/adapters/README.md).
- **Docs** — [docs/engine-architecture.md](docs/engine-architecture.md) (core vs adapters).
- **Embeddings** — LRU cache, keep_alive, batch chunking, truncation (Ollama path).
- **KPI drift** — `core/kpi-drift.mjs` + engine novelty public demo route path.

### Architecture
- Core remains **zero-dependency**. Optional peers live only in adapters.
- LangGraph / LangChain **propose**; Orchestrator + Governance **decide**.
- Langfuse is observability only — not a source of truth for idea state.

### Config
- `KAYROS_SEARCH_PROVIDER`, `KAYROS_SEARCH_LIMIT`, `TAVILY_API_KEY`, `BRAVE_API_KEY`
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_RELEASE`

---

## Previous releases

See git history and earlier CHANGELOG sections on `main` for v0.15 (novelty ranking, Kayros Signature), v0.14 (Slack links / motif), v0.13–v0.2.
