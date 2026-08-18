export const SALES_ORACLE_API_BASE = 'https://api.kayroslab.com';

const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
});

export function resolvedMimeType(file) {
  if (file?.type) return String(file.type).toLowerCase();
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

export async function sha256Hex(file) {
  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function messageFromPayload(payload, fallback) {
  if (typeof payload?.error === 'string') return payload.error;
  return payload?.error?.message || payload?.message || fallback;
}

export class SalesOracleClient {
  constructor({ baseUrl = SALES_ORACLE_API_BASE, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.token = null;
  }

  setToken(token) { this.token = token || null; }

  async request(path, { method = 'GET', body, authenticated = true } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authenticated && this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(messageFromPayload(payload, `HTTP ${response.status}`));
      error.status = response.status; error.code = payload?.error?.code || null; throw error;
    }
    return payload;
  }

  async login(email, password) {
    const session = await this.request('/v1/auth/login', { method: 'POST', body: { email, password }, authenticated: false });
    this.setToken(session.token); return session;
  }

  async logout() {
    try { if (this.token) await this.request('/v1/auth/logout', { method: 'POST' }); }
    finally { this.setToken(null); }
  }

  listCases() { return this.request('/v1/sales-oracle/cases'); }
  createCase(input) { return this.request('/v1/sales-oracle/cases', { method: 'POST', body: input }); }
  listDocuments(caseId) { return this.request(`/v1/sales-oracle/cases/${encodeURIComponent(caseId)}/documents`); }

  async uploadDocument(caseId, file, { sourceType = 'other', sensitivity = 'confidential', onStage = () => {} } = {}) {
    onStage('hashing');
    const sha256 = await sha256Hex(file);
    onStage('signing');
    const initiated = await this.request(`/v1/sales-oracle/cases/${encodeURIComponent(caseId)}/documents/uploads`, {
      method: 'POST', body: {
        filename: file.name, mime_type: resolvedMimeType(file), size_bytes: file.size,
        sha256, source_type: sourceType, sensitivity,
      },
    });
    onStage('uploading');
    const uploadResponse = await this.fetch(initiated.upload.url, {
      method: initiated.upload.method || 'PUT', headers: initiated.upload.headers || {}, body: file,
    });
    if (!uploadResponse.ok) throw new Error(`Object upload failed (HTTP ${uploadResponse.status})`);
    onStage('verifying');
    const completed = await this.request(
      `/v1/sales-oracle/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(initiated.document.document_id)}/complete`,
      { method: 'POST', body: {} },
    );
    onStage('queued');
    return completed;
  }
}

function initSalesOracleTool() {
  const root = document.querySelector('[data-sales-oracle-tool]');
  if (!root) return;
  const copy = root.dataset;
  const client = new SalesOracleClient({ baseUrl: copy.apiBase || SALES_ORACLE_API_BASE });
  const byId = (id) => root.querySelector(`#${id}`);
  const loginForm = byId('so-login-form');
  const caseForm = byId('so-case-form');
  const uploadForm = byId('so-upload-form');
  const caseFields = byId('so-case-fields');
  const uploadFields = byId('so-upload-fields');
  const caseSelect = byId('so-case-select');
  const logoutButton = byId('so-logout');
  const status = byId('so-tool-status');
  const documentList = byId('so-document-list');
  let currentCase = null;
  let cases = [];

  const setStatus = (text, tone = 'neutral') => {
    status.textContent = text; status.dataset.tone = tone;
  };
  const setButtonBusy = (button, busy) => {
    button.disabled = busy; button.setAttribute('aria-busy', String(busy));
  };
  const setCurrentCase = async (record) => {
    currentCase = record || null;
    uploadFields.disabled = !currentCase;
    if (!currentCase) return;
    setStatus(`${copy.caseSelected}: ${currentCase.name}`, 'success');
    const result = await client.listDocuments(currentCase.case_id);
    renderDocuments(result.documents || []);
  };
  const renderDocuments = (documents) => {
    documentList.replaceChildren();
    if (!documents.length) {
      const empty = document.createElement('li'); empty.className = 'sales-oracle-tool__empty';
      empty.textContent = copy.noDocuments; documentList.append(empty); return;
    }
    documents.forEach((item) => {
      const row = document.createElement('li'); row.className = 'sales-oracle-tool__document';
      const name = document.createElement('span'); name.textContent = item.original_filename;
      const state = document.createElement('span'); state.textContent = item.status; state.className = 'sales-oracle-tool__document-state';
      row.append(name, state); documentList.append(row);
    });
  };
  const loadCases = async () => {
    const result = await client.listCases(); cases = result.cases || [];
    caseSelect.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = '';
    placeholder.textContent = cases.length ? copy.chooseCase : copy.noCases;
    caseSelect.append(placeholder);
    cases.forEach((item) => {
      const option = document.createElement('option'); option.value = item.case_id;
      option.textContent = `${item.name} · ${item.status}`; caseSelect.append(option);
    });
    caseSelect.disabled = !cases.length;
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = loginForm.querySelector('button[type="submit"]');
    setButtonBusy(button, true); setStatus(copy.connecting);
    try {
      const data = new FormData(loginForm);
      await client.login(data.get('email'), data.get('password'));
      loginForm.querySelectorAll('input').forEach((input) => { input.disabled = true; });
      button.hidden = true; logoutButton.hidden = false; caseFields.disabled = false;
      await loadCases(); setStatus(copy.connected, 'success');
    } catch (error) { setStatus(error.message || copy.error, 'error'); }
    finally { setButtonBusy(button, false); }
  });

  logoutButton.addEventListener('click', async () => {
    await client.logout().catch(() => {}); currentCase = null; cases = [];
    loginForm.reset(); loginForm.querySelectorAll('input').forEach((input) => { input.disabled = false; });
    loginForm.querySelector('button[type="submit"]').hidden = false; logoutButton.hidden = true;
    caseFields.disabled = true; uploadFields.disabled = true; caseSelect.replaceChildren(); renderDocuments([]);
    setStatus(copy.loggedOut);
  });

  caseSelect.addEventListener('change', async () => {
    const selected = cases.find((item) => item.case_id === caseSelect.value);
    try { await setCurrentCase(selected); } catch (error) { setStatus(error.message || copy.error, 'error'); }
  });

  caseForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = caseForm.querySelector('button[type="submit"]');
    setButtonBusy(button, true); setStatus(copy.creatingCase);
    try {
      const data = new FormData(caseForm);
      const created = await client.createCase({
        name: data.get('name'), use_case: data.get('use_case'), decision_question: data.get('decision_question'),
      });
      await loadCases(); caseSelect.value = created.case_id; await setCurrentCase(created); caseForm.reset();
    } catch (error) { setStatus(error.message || copy.error, 'error'); }
    finally { setButtonBusy(button, false); }
  });

  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentCase) { setStatus(copy.caseRequired, 'error'); return; }
    const files = [...byId('so-files').files];
    if (!files.length) { setStatus(copy.filesRequired, 'error'); return; }
    const button = uploadForm.querySelector('button[type="submit"]');
    const sourceType = new FormData(uploadForm).get('source_type'); setButtonBusy(button, true);
    try {
      for (const file of files) {
        await client.uploadDocument(currentCase.case_id, file, {
          sourceType, onStage: (stage) => setStatus(`${file.name} · ${copy[`stage${stage[0].toUpperCase()}${stage.slice(1)}`] || stage}`),
        });
      }
      uploadForm.reset(); const result = await client.listDocuments(currentCase.case_id);
      renderDocuments(result.documents || []); setStatus(copy.uploadComplete, 'success');
    } catch (error) { setStatus(error.message || copy.error, 'error'); }
    finally { setButtonBusy(button, false); }
  });

  renderDocuments([]); setStatus(copy.loginRequired);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSalesOracleTool);
  else initSalesOracleTool();
}
