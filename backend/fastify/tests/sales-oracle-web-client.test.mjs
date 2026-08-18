import test from 'node:test';
import assert from 'node:assert/strict';
import { SalesOracleClient, resolvedMimeType, salesOracleActionRequirement, sha256Hex } from '../../web/public/assets/sales-oracle-tool.js';

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  async json() { return payload; }, async text() { return JSON.stringify(payload); },
});

test('Sales Oracle web client hashes locally and infers safe MIME types', async () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(await sha256Hex({ arrayBuffer: async () => bytes.buffer }), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(resolvedMimeType({ name: 'brief.md', type: '' }), 'text/markdown');
  assert.equal(resolvedMimeType({ name: 'payload.exe', type: '' }), 'application/octet-stream');
});

test('Sales Oracle actions stay clickable and report the missing prerequisite', () => {
  assert.equal(salesOracleActionRequirement('case', { authenticated: false }), 'login');
  assert.equal(salesOracleActionRequirement('case', { authenticated: true }), null);
  assert.equal(salesOracleActionRequirement('upload', { authenticated: true }), 'case');
  assert.equal(salesOracleActionRequirement('upload', { authenticated: true, currentCase: { case_id: 'case-1' } }), null);
});

test('Sales Oracle web client keeps the bearer token in memory and completes the signed upload cycle', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/auth/login')) return jsonResponse({ token: 'session-token' });
    if (url.endsWith('/documents/uploads')) return jsonResponse({
      document: { document_id: 'doc-1' },
      upload: { method: 'PUT', url: 'https://objects.test/signed', headers: { 'x-amz-checksum-sha256': 'checksum' } },
    }, 201);
    if (url === 'https://objects.test/signed') return { ok: true, status: 200 };
    if (url.endsWith('/documents/doc-1/complete')) return jsonResponse({ document: { document_id: 'doc-1', status: 'uploaded' }, ingestion_job_id: 'job-1' }, 202);
    throw new Error(`unexpected URL: ${url}`);
  };
  const client = new SalesOracleClient({ baseUrl: 'https://api.test', fetchImpl });
  await client.login('buyer@example.com', 'secret');
  const fileBytes = new TextEncoder().encode('RFP');
  const file = { name: 'rfp.pdf', type: 'application/pdf', size: fileBytes.byteLength, arrayBuffer: async () => fileBytes.buffer };
  const stages = [];
  const completed = await client.uploadDocument('case-1', file, { sourceType: 'rfp', onStage: (stage) => stages.push(stage) });
  assert.equal(completed.ingestion_job_id, 'job-1');
  assert.deepEqual(stages, ['hashing', 'signing', 'uploading', 'verifying', 'queued']);
  assert.equal(calls[1].options.headers.authorization, 'Bearer session-token');
  assert.equal(calls[2].options.body, file);
});
