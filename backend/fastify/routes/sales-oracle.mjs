import { z } from 'zod';

const caseSchema = z.object({
  name: z.string().min(1).max(300),
  use_case: z.enum(['comex_decision', 'rfp', 'renewal', 'negotiation']).optional().default('rfp'),
  decision_question: z.string().min(1).max(12000),
  client_reference: z.string().max(300).optional(),
  committee_date: z.iso.datetime().optional(),
  retention_days: z.number().int().min(1).max(3650).optional(),
});

const uploadSchema = z.object({
  filename: z.string().min(1).max(500), mime_type: z.string().min(1).max(200),
  size_bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  source_type: z.enum(['rfp', 'proposal', 'contract', 'security', 'financial', 'meeting_notes', 'organization', 'personality_profile', 'other']).optional(),
  sensitivity: z.enum(['internal', 'confidential', 'restricted']).optional(),
});

const completeSchema = z.object({ etag: z.string().max(300).optional() });

async function sessionFor(app, req) {
  const auth = app.kayrosContext?.auth;
  const header = req.headers.authorization || '';
  if (!auth || !header.startsWith('Bearer ')) return null;
  try { return await auth.verify(header.slice(7)); } catch { return null; }
}

function failure(req, reply, error) {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({ error: { code: error?.code || 'INVALID_REQUEST', message: String(error?.message || error), request_id: req.id } });
}

export default async function salesOracleRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    const session = await sessionFor(app, req);
    if (!session?.sub) return reply.code(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'session humaine authentifiée requise', request_id: req.id } });
    req.salesOracleSession = session;
  });

  const scope = (req) => ({ tenantId: req.salesOracleSession.tenantId || null, by: req.salesOracleSession.sub });
  const service = () => app.kayrosContext?.salesOracle;

  app.post('/v1/sales-oracle/cases', async (req, reply) => {
    const parsed = caseSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'dossier invalide', request_id: req.id, issues: parsed.error.issues } });
    try { return reply.code(201).send(await service().createCase(parsed.data, scope(req))); } catch (error) { return failure(req, reply, error); }
  });

  app.get('/v1/sales-oracle/cases', async (req) => ({ cases: await service().listCases({ ...scope(req), status: req.query?.status || null }) }));

  app.get('/v1/sales-oracle/cases/:caseId', async (req, reply) => {
    const record = await service().getCase(req.params.caseId, scope(req));
    return record || reply.code(404).send({ error: { code: 'RESOURCE_NOT_FOUND', message: 'dossier Sales Oracle introuvable', request_id: req.id } });
  });

  app.post('/v1/sales-oracle/cases/:caseId/documents/uploads', async (req, reply) => {
    const parsed = uploadSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'upload invalide', request_id: req.id, issues: parsed.error.issues } });
    try { return reply.code(201).send(await service().initiateDocumentUpload(req.params.caseId, parsed.data, scope(req))); }
    catch (error) { return failure(req, reply, error); }
  });

  app.post('/v1/sales-oracle/cases/:caseId/documents/:documentId/complete', async (req, reply) => {
    const parsed = completeSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'confirmation invalide', request_id: req.id, issues: parsed.error.issues } });
    try { return reply.code(202).send(await service().completeDocumentUpload(req.params.caseId, req.params.documentId, parsed.data, scope(req))); }
    catch (error) { return failure(req, reply, error); }
  });

  app.get('/v1/sales-oracle/cases/:caseId/documents', async (req, reply) => {
    try { return { documents: await service().listDocuments(req.params.caseId, scope(req)) }; }
    catch (error) { return failure(req, reply, error); }
  });

  app.get('/v1/sales-oracle/documents/:documentId/status', async (req, reply) => {
    try { return await service().getDocumentStatus(req.params.documentId, scope(req)); }
    catch (error) { return failure(req, reply, error); }
  });
}
