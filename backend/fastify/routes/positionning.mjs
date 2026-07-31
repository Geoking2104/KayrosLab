import { z } from 'zod';

const publicAnalyzeRate = new Map();
const PUBLIC_ANALYZE_MAX_PER_HOUR = 20;

function checkPublicAnalyzeRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let entry = publicAnalyzeRate.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    publicAnalyzeRate.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= PUBLIC_ANALYZE_MAX_PER_HOUR;
}

export default async function positionningRoute(app) {
  const searchSchema = z.object({ q: z.string().min(1), limit: z.number().optional().default(5) });
  const analyzeSchema = z.object({ idea: z.string().min(1), limit: z.number().optional().default(5), gapThreshold: z.number().optional() });
  const owlSchema = z.object({ competitors: z.array(z.any()).optional().default([]) });

  async function runMistralAnalysis({ idea, limit, gapThreshold }) {
    const ctx = app.kayrosContext;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 3));
    const { runMistralContextualPositionning } = await import('../../../core/positionning/index.mjs');
    return runMistralContextualPositionning(idea, {
      apiKey: ctx.MISTRAL_API_KEY,
      model: ctx.MISTRAL_MODEL,
      limit: safeLimit,
      gapThreshold,
      googleApiKey: ctx.GOOGLE_API_KEY,
      googleCx: ctx.GOOGLE_CX,
      githubToken: ctx.GITHUB_TOKEN,
      gitlabToken: ctx.GITLAB_TOKEN,
      gitlabBaseUrl: ctx.GITLAB_BASE_URL,
    });
  }

  // Ontology catalogue + Cytoscape graph payload
  app.get('/v1/positionning/ontology', async (req, reply) => {
    const {
      ENTITY_TYPES, RELATIONSHIPS, TECH_ENTITY_IDS, BUSINESS_ENTITY_IDS,
    } = await import('../../../core/positionning/ontology.mjs');
    const group = ['tech', 'business', 'all'].includes(req.query?.group) ? req.query.group : 'all';
    const { ontologyToCytoscape } = await import('../../../core/positionning/ontology-graph.mjs');
    const graph = ontologyToCytoscape({ group });
    return {
      entities: ENTITY_TYPES,
      relationships: RELATIONSHIPS,
      techIds: TECH_ENTITY_IDS,
      businessIds: BUSINESS_ENTITY_IDS,
      graph,
    };
  });

  app.post('/v1/positionning/search', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Field "q" required', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    const ctx = app.kayrosContext;
    try {
      const { WebScanner } = await import('../../../core/positionning/scanner-web.mjs');
      const scanner = new WebScanner({ googleApiKey: ctx.GOOGLE_API_KEY, googleCx: ctx.GOOGLE_CX });
      const results = await scanner.search(q, { limit });
      return { results, provider: ctx.GOOGLE_API_KEY ? 'google' : 'duckduckgo' };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Search failed', message: err.message });
    }
  });

  app.post('/v1/positionning/github', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Field "q" required', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    try {
      const { GitHubScanner } = await import('../../../core/positionning/scanner-github.mjs');
      const scanner = new GitHubScanner({ token: app.kayrosContext.GITHUB_TOKEN });
      const results = await scanner.search(q, { limit });
      return { results };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'GitHub search failed', message: err.message });
    }
  });

  app.post('/v1/positionning/arxiv', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Field "q" required', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    try {
      const { ArXivScanner } = await import('../../../core/positionning/scanner-arxiv.mjs');
      const scanner = new ArXivScanner();
      const results = await scanner.search(q, { limit });
      return { results };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'ArXiv search failed', message: err.message });
    }
  });

  app.post('/v1/positionning/analyze', async (req, reply) => {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Field "idea" required', issues: parsed.error.issues });
    const { idea, limit, gapThreshold } = parsed.data;
    try {
      const result = await runMistralAnalysis({ idea, limit, gapThreshold });
      return result;
    } catch (err) {
      app.log.error(err);
      return reply.code(err.code === 'NO_KEY' ? 503 : 502).send({ error: 'Mistral ontology analysis failed', message: err.message });
    }
  });

  app.post('/v1/demo/positionning/analyze', async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.ip
      || 'unknown';
    if (!checkPublicAnalyzeRate(ip)) {
      return reply.code(429).send({ error: `Positioner quota exceeded (${PUBLIC_ANALYZE_MAX_PER_HOUR}/h). Try later.` });
    }

    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Field "idea" required', issues: parsed.error.issues });
    const { idea, limit, gapThreshold } = parsed.data;

    try {
      const result = await runMistralAnalysis({ idea, limit, gapThreshold });
      return result;
    } catch (err) {
      app.log.error(err);
      return reply.code(err.code === 'NO_KEY' ? 503 : 502).send({ error: 'Mistral contextual search failed', message: err.message });
    }
  });

  app.post('/v1/positionning/export/owl', async (req, reply) => {
    const parsed = owlSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { competitors } = parsed.data;
    const { generateOWL } = await import('../../../core/positionning/owl-exporter.mjs');
    const owl = generateOWL(competitors);
    reply.header('Content-Type', 'application/rdf+xml; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="positionning-ontology.rdf"');
    return reply.send(owl);
  });
}
