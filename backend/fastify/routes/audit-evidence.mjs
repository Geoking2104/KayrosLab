// Journal d'audit scellé : clé publique, têtes de chaîne et ancrage manuel.
// GET est public par conception (clé publique + empreintes : rien de secret) ;
// POST passe par le preHandler x-kayros-secret comme toute écriture.
export default async function auditEvidenceRoutes(app) {
  app.get('/v1/audit/evidence', async () => {
    const ae = app.kayrosContext.auditEvidence;
    if (!ae?.enabled) return { enabled: false, ...(ae?.error ? { error: ae.error } : {}) };
    await ae.sink.flush();
    return ae.describe();
  });
  app.get('/v1/audit/evidence/public-key', async (req, reply) => {
    const ae = app.kayrosContext.auditEvidence;
    if (!ae?.enabled) return reply.code(404).send({ error: 'journal scellé désactivé' });
    reply.type('application/x-pem-file');
    return ae.publicKey;
  });
  app.post('/v1/audit/evidence/anchor', async (req, reply) => {
    const ae = app.kayrosContext.auditEvidence;
    if (!ae?.enabled) return reply.code(409).send({ error: 'journal scellé désactivé' });
    if (!ae.anchors) return reply.code(409).send({ error: 'aucune destination d\'ancrage (KAYROS_AUDIT_ANCHOR_DIR ou KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN)' });
    const result = await ae.anchors.anchorNow({ force: !!req.body?.force, note: req.body?.note ? String(req.body.note).slice(0, 200) : undefined });
    if (result.skipped) return { skipped: true, reason: result.reason, last: result.last };
    return { skipped: false, digest: result.manifest.digest, entries: result.manifest.entries, receipts: result.receipts };
  });
}
