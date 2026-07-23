import { z } from 'zod';

export default async function positionningRoute(app) {
  const searchSchema = z.object({ q: z.string().min(1), limit: z.number().optional().default(5) });
  const analyzeSchema = z.object({ idea: z.string().min(1), limit: z.number().optional().default(5), gapThreshold: z.number().optional() });
  const owlSchema = z.object({ competitors: z.array(z.any()).optional().default([]) });

  app.post('/v1/positionning/search', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champ "q" requis', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    const ctx = app.kayrosContext;
    try {
      const { WebScanner } = await import('../../core/positionning/scanner-web.mjs');
      const scanner = new WebScanner({ googleApiKey: ctx.GOOGLE_API_KEY, googleCx: ctx.GOOGLE_CX });
      const results = await scanner.search(q, { limit });
      return { results, provider: ctx.GOOGLE_API_KEY ? 'google' : 'duckduckgo' };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Echec de la recherche', message: err.message });
    }
  });

  app.post('/v1/positionning/github', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champ "q" requis', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    try {
      const { GitHubScanner } = await import('../../core/positionning/scanner-github.mjs');
      const scanner = new GitHubScanner({ token: app.kayrosContext.GITHUB_TOKEN });
      const results = await scanner.search(q, { limit });
      return { results };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Echec de la recherche GitHub', message: err.message });
    }
  });

  app.post('/v1/positionning/arxiv', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champ "q" requis', issues: parsed.error.issues });
    const { q, limit } = parsed.data;
    try {
      const { ArXivScanner } = await import('../../core/positionning/scanner-arxiv.mjs');
      const scanner = new ArXivScanner();
      const results = await scanner.search(q, { limit });
      return { results };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Echec de la recherche ArXiv', message: err.message });
    }
  });

  app.post('/v1/positionning/analyze', async (req, reply) => {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Champ "idea" requis', issues: parsed.error.issues });
    const { idea, limit, gapThreshold } = parsed.data;
    const ctx = app.kayrosContext;
    try {
      const { runPositionningAnalysis } = await import('../../core/positionning/index.mjs');
      const result = await runPositionningAnalysis(idea, { googleApiKey: ctx.GOOGLE_API_KEY, googleCx: ctx.GOOGLE_CX, githubToken: ctx.GITHUB_TOKEN, limit, gapThreshold });
      return result;
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: "Echec de l'analyse ontologique", message: err.message });
    }
  });

  app.post('/v1/positionning/export/owl', async (req, reply) => {
    const parsed = owlSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { competitors } = parsed.data;
    const { generateOWL } = await import('../../core/positionning/owl-exporter.mjs');
    const owl = generateOWL(competitors);
    reply.header('Content-Type', 'application/rdf+xml; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="positionning-ontology.rdf"');
    return reply.send(owl);
  });
}
