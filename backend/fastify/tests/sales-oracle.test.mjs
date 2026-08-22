import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';

const sha = 'a'.repeat(64);

async function authenticatedApp() {
  const { app, ctx } = await buildTestApp();
  const email = `sales-oracle-${Date.now()}-${Math.random()}@test.local`;
  await registerComex(ctx, { email });
  const token = await bearer(ctx, email, 'secret1234');
  ctx.salesOracle.objectStorage = {
    configured: true,
    async createUpload({ objectKey, contentType, sha256 }) {
      return {
        method: 'PUT', url: `https://objects.test/${encodeURIComponent(objectKey)}`,
        headers: { 'content-type': contentType, 'x-amz-meta-sha256': sha256 },
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      };
    },
    async headObject() { return { sizeBytes: 1024, sha256: sha, etag: 'etag-1' }; },
  };
  return { app, ctx, token };
}

test('Sales Oracle requires a human session', async (t) => {
  const { app } = await buildTestApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/sales-oracle/cases' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'AUTHENTICATION_REQUIRED');
});

test('creates a tenant-scoped case and queues a verified document', async (t) => {
  const { app, ctx, token } = await authenticatedApp();
  t.after(() => app.close());
  const auth = { authorization: `Bearer ${token}` };

  const created = await app.inject({
    method: 'POST', url: '/v1/sales-oracle/cases', headers: auth,
    payload: { name: 'Strategic RFP', use_case: 'rfp', decision_question: 'Should we submit this proposal?' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const salesCase = created.json();
  assert.equal(salesCase.tenant_id, 't1');
  assert.equal(salesCase.status, 'draft');

  const initiated = await app.inject({
    method: 'POST', url: `/v1/sales-oracle/cases/${salesCase.case_id}/documents/uploads`, headers: auth,
    payload: { filename: 'customer-rfp.pdf', mime_type: 'application/pdf', size_bytes: 1024, sha256: sha, source_type: 'rfp' },
  });
  assert.equal(initiated.statusCode, 201, initiated.body);
  const upload = initiated.json();
  assert.equal(upload.upload.method, 'PUT');
  assert.equal(upload.document.status, 'upload_pending');
  assert.equal(upload.document.tenant_id, 't1');

  const completed = await app.inject({
    method: 'POST',
    url: `/v1/sales-oracle/cases/${salesCase.case_id}/documents/${upload.document.document_id}/complete`,
    headers: auth, payload: { etag: 'etag-1' },
  });
  assert.equal(completed.statusCode, 202, completed.body);
  assert.equal(completed.json().document.status, 'uploaded');
  assert.match(completed.json().ingestion_job_id, /^sojob_/);
  assert.equal((await ctx.salesOracleRepository.getCase(salesCase.case_id, { tenantId: 't1' })).status, 'ingesting');

  const status = await app.inject({ method: 'GET', url: `/v1/sales-oracle/documents/${upload.document.document_id}/status`, headers: auth });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().status, 'uploaded');

  const duplicate = await app.inject({
    method: 'POST', url: `/v1/sales-oracle/cases/${salesCase.case_id}/documents/uploads`, headers: auth,
    payload: { filename: 'copy.pdf', mime_type: 'application/pdf', size_bytes: 1024, sha256: sha },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'DOCUMENT_DUPLICATE');
});

test('does not expose a Sales Oracle case to another tenant', async (t) => {
  const { app, ctx, token } = await authenticatedApp();
  t.after(() => app.close());
  const created = await app.inject({
    method: 'POST', url: '/v1/sales-oracle/cases', headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Private case', decision_question: 'What can veto this deal?' },
  });
  const caseId = created.json().case_id;

  const otherEmail = `other-${Date.now()}-${Math.random()}@test.local`;
  await ctx.auth.register({ email: otherEmail, password: 'secret1234', role: 'comex', tenantId: 't2' });
  const otherToken = await bearer(ctx, otherEmail, 'secret1234');
  const hidden = await app.inject({
    method: 'GET', url: `/v1/sales-oracle/cases/${caseId}`,
    headers: { authorization: `Bearer ${otherToken}` },
  });
  assert.equal(hidden.statusCode, 404);
});

test('rejects unsupported and oversized documents before signing an upload', async (t) => {
  const { app, token } = await authenticatedApp();
  t.after(() => app.close());
  const auth = { authorization: `Bearer ${token}` };
  const created = await app.inject({
    method: 'POST', url: '/v1/sales-oracle/cases', headers: auth,
    payload: { name: 'Document limits', decision_question: 'Is the corpus safe?' },
  });
  const caseId = created.json().case_id;
  const unsupported = await app.inject({
    method: 'POST', url: `/v1/sales-oracle/cases/${caseId}/documents/uploads`, headers: auth,
    payload: { filename: 'payload.exe', mime_type: 'application/octet-stream', size_bytes: 10, sha256: 'b'.repeat(64) },
  });
  assert.equal(unsupported.statusCode, 415);
  const oversized = await app.inject({
    method: 'POST', url: `/v1/sales-oracle/cases/${caseId}/documents/uploads`, headers: auth,
    payload: { filename: 'huge.pdf', mime_type: 'application/pdf', size_bytes: 50 * 1024 * 1024 + 1, sha256: 'c'.repeat(64) },
  });
  assert.equal(oversized.statusCode, 413);
});
