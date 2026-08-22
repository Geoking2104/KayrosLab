// KayrosLab — Sales Oracle case and secure document-upload lifecycle.
// Raw document bytes remain in object storage. This service owns tenant-scoped
// metadata and hands completed uploads to the asynchronous ingestion queue.

export const SALES_ORACLE_USE_CASES = Object.freeze(['comex_decision', 'rfp', 'renewal', 'negotiation']);
export const SALES_ORACLE_CASE_STATUSES = Object.freeze(['draft', 'ingesting', 'evidence_review', 'ready', 'running', 'pending_human_arbitration', 'finalized', 'archived', 'purge_pending']);
export const SALES_ORACLE_DOCUMENT_STATUSES = Object.freeze(['upload_pending', 'uploaded', 'scanning', 'extracting', 'chunking', 'indexing', 'ready', 'rejected', 'failed', 'purge_pending', 'deleted']);
export const SALES_ORACLE_SOURCE_TYPES = Object.freeze(['rfp', 'proposal', 'contract', 'security', 'financial', 'meeting_notes', 'organization', 'personality_profile', 'other']);
export const SALES_ORACLE_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown', 'text/csv', 'application/csv',
]);

const DEFAULT_LIMITS = Object.freeze({ maxDocumentBytes: 50 * 1024 * 1024, maxDocumentsPerCase: 20, maxCaseBytes: 250 * 1024 * 1024 });
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const tenantKey = (tenantId) => String(tenantId || 'default');
const extensionForMime = (mime) => ({
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/csv': '.csv',
}[mime] || '');

function problem(code, message, statusCode = 400) {
  const error = new Error(message); error.code = code; error.statusCode = statusCode; return error;
}

function required(value, field) {
  const out = String(value || '').trim();
  if (!out) throw problem('INVALID_REQUEST', `${field} requis`);
  return out;
}

export class InMemorySalesOracleRepository {
  constructor() { this.cases = new Map(); this.documents = new Map(); this.jobs = new Map(); }
  _key(tenantId, id) { return `${tenantKey(tenantId)}:${id}`; }
  async saveCase(record) { this.cases.set(this._key(record.tenant_id, record.case_id), clone(record)); return clone(record); }
  async getCase(caseId, { tenantId } = {}) { return clone(this.cases.get(this._key(tenantId, caseId)) || null); }
  async listCases({ tenantId, status } = {}) {
    return [...this.cases.values()].filter((x) => x.tenant_id === tenantKey(tenantId) && (!status || x.status === status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(clone);
  }
  async saveDocument(record) { this.documents.set(this._key(record.tenant_id, record.document_id), clone(record)); return clone(record); }
  async getDocument(documentId, { tenantId } = {}) { return clone(this.documents.get(this._key(tenantId, documentId)) || null); }
  async listDocuments(caseId, { tenantId } = {}) {
    return [...this.documents.values()].filter((x) => x.tenant_id === tenantKey(tenantId) && x.case_id === caseId && x.status !== 'deleted')
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(clone);
  }
  async findDocumentBySha(caseId, sha256, { tenantId } = {}) {
    return clone([...this.documents.values()].find((x) => x.tenant_id === tenantKey(tenantId) && x.case_id === caseId && x.sha256 === sha256 && x.status !== 'deleted') || null);
  }
  async saveJob(record) { this.jobs.set(this._key(record.tenant_id, record.job_id), clone(record)); return clone(record); }
}

export class SalesOracleService {
  constructor({ repository = new InMemorySalesOracleRepository(), objectStorage = null, limits = {} } = {}) {
    this.repository = repository;
    this.objectStorage = objectStorage;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async createCase(input, { tenantId = null, by = null } = {}) {
    const use_case = String(input?.use_case || 'rfp');
    if (!SALES_ORACLE_USE_CASES.includes(use_case)) throw problem('INVALID_REQUEST', `use_case invalide: ${use_case}`);
    const created_at = now();
    const retentionDays = Math.min(3650, Math.max(1, Number(input?.retention_days) || 90));
    return this.repository.saveCase({
      case_id: uid('socase'), tenant_id: tenantKey(tenantId),
      name: required(input?.name, 'name'), use_case,
      decision_question: required(input?.decision_question, 'decision_question'),
      client_reference: String(input?.client_reference || '').trim() || null,
      committee_date: input?.committee_date || null, status: 'draft', corpus_version: 1,
      retention_until: new Date(Date.now() + retentionDays * 86400000).toISOString(),
      created_by: by || null, created_at, updated_at: created_at,
    });
  }

  async listCases({ tenantId = null, status = null } = {}) { return this.repository.listCases({ tenantId, status }); }
  async getCase(caseId, { tenantId = null } = {}) {
    return this.repository.getCase(caseId, { tenantId });
  }

  async initiateDocumentUpload(caseId, input, { tenantId = null, by = null } = {}) {
    const scope = { tenantId };
    const salesCase = await this.repository.getCase(caseId, scope);
    if (!salesCase) throw problem('RESOURCE_NOT_FOUND', 'dossier Sales Oracle introuvable', 404);
    if (!this.objectStorage?.configured) throw problem('OBJECT_STORAGE_UNAVAILABLE', 'stockage objet non configuré', 503);
    const filename = required(input?.filename, 'filename');
    const mime_type = String(input?.mime_type || '').toLowerCase();
    if (!SALES_ORACLE_MIME_TYPES.includes(mime_type)) throw problem('UNSUPPORTED_MEDIA_TYPE', `type MIME non supporté: ${mime_type}`, 415);
    const size_bytes = Number(input?.size_bytes);
    if (!Number.isSafeInteger(size_bytes) || size_bytes <= 0) throw problem('INVALID_REQUEST', 'size_bytes invalide');
    if (size_bytes > this.limits.maxDocumentBytes) throw problem('FILE_TOO_LARGE', 'document trop volumineux', 413);
    const sha256 = String(input?.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw problem('INVALID_REQUEST', 'sha256 hexadécimal requis');
    const source_type = String(input?.source_type || 'other');
    if (!SALES_ORACLE_SOURCE_TYPES.includes(source_type)) throw problem('INVALID_REQUEST', `source_type invalide: ${source_type}`);
    const existing = await this.repository.findDocumentBySha(caseId, sha256, scope);
    if (existing) throw problem('DOCUMENT_DUPLICATE', `document déjà enregistré: ${existing.document_id}`, 409);
    const documents = await this.repository.listDocuments(caseId, scope);
    if (documents.length >= this.limits.maxDocumentsPerCase) throw problem('CASE_DOCUMENT_LIMIT', 'nombre maximal de documents atteint', 409);
    if (documents.reduce((sum, doc) => sum + Number(doc.size_bytes || 0), 0) + size_bytes > this.limits.maxCaseBytes) {
      throw problem('CASE_STORAGE_LIMIT', 'quota documentaire du dossier dépassé', 413);
    }
    const document_id = uid('sodoc');
    // The original filename can contain customer or project information. Keep
    // it in tenant-scoped metadata, never in the signed object URL.
    const object_key = `sales-oracle/${tenantKey(tenantId)}/${caseId}/${document_id}${extensionForMime(mime_type)}`;
    const upload = await this.objectStorage.createUpload({ objectKey: object_key, contentType: mime_type, sizeBytes: size_bytes, sha256 });
    const document = await this.repository.saveDocument({
      document_id, tenant_id: tenantKey(tenantId), case_id: caseId, source_type,
      original_filename: filename, mime_type, size_bytes, sha256, object_key,
      sensitivity: String(input?.sensitivity || 'confidential'), status: 'upload_pending',
      language: null, page_count: null, extraction_error: null, uploaded_by: by || null,
      uploaded_at: now(), processed_at: null, deleted_at: null,
    });
    return { document, upload };
  }

  async completeDocumentUpload(caseId, documentId, input = {}, { tenantId = null, by = null } = {}) {
    const document = await this.repository.getDocument(documentId, { tenantId });
    if (!document || document.case_id !== caseId) throw problem('RESOURCE_NOT_FOUND', 'document introuvable', 404);
    if (document.status === 'uploaded') return { document, ingestion_job_id: null, idempotent: true };
    if (document.status !== 'upload_pending') throw problem('DOCUMENT_STATE_CONFLICT', `upload non finalisable depuis ${document.status}`, 409);
    const head = await this.objectStorage.headObject({ objectKey: document.object_key });
    if (Number(head.sizeBytes) !== Number(document.size_bytes)) throw problem('DOCUMENT_SIZE_MISMATCH', 'taille stockée différente de la taille déclarée', 422);
    if (!head.sha256) throw problem('DOCUMENT_CHECKSUM_UNVERIFIED', 'le stockage n’a pas retourné de checksum SHA-256 vérifiable', 422);
    if (String(head.sha256).toLowerCase() !== document.sha256) throw problem('DOCUMENT_CHECKSUM_MISMATCH', 'checksum stocké différent du checksum déclaré', 422);
    const updated = await this.repository.saveDocument({ ...document, status: 'uploaded', storage_etag: head.etag || input?.etag || null });
    const job = await this.repository.saveJob({
      job_id: uid('sojob'), tenant_id: tenantKey(tenantId), document_id: documentId,
      job_type: 'ingest_document', status: 'queued', attempt_count: 0,
      available_at: now(), locked_at: null, locked_by: null, error: null,
      created_by: by || null, created_at: now(), completed_at: null,
    });
    const salesCase = await this.repository.getCase(caseId, { tenantId });
    if (salesCase && salesCase.status === 'draft') await this.repository.saveCase({ ...salesCase, status: 'ingesting', updated_at: now() });
    return { document: updated, ingestion_job_id: job.job_id, idempotent: false };
  }

  async listDocuments(caseId, { tenantId = null } = {}) {
    if (!await this.repository.getCase(caseId, { tenantId })) throw problem('RESOURCE_NOT_FOUND', 'dossier Sales Oracle introuvable', 404);
    return this.repository.listDocuments(caseId, { tenantId });
  }

  async getDocumentStatus(documentId, { tenantId = null } = {}) {
    const document = await this.repository.getDocument(documentId, { tenantId });
    if (!document) throw problem('RESOURCE_NOT_FOUND', 'document introuvable', 404);
    return { document_id: document.document_id, case_id: document.case_id, status: document.status, error: document.extraction_error || null, processed_at: document.processed_at || null };
  }
}
