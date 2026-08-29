function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function key(tenantId, platform, messageId) { return `${tenantId || 'default'}:${platform}:${messageId}`; }

/** Async in-memory contract used locally and as the reference implementation for PostgreSQL. */
export class InMemoryCollaborationStore {
  constructor({ maxEvents = 1000 } = {}) {
    this.maxEvents = Math.max(50, Number(maxEvents) || 1000);
    this.rooms = new Map();
    this.external = new Map();
    this.events = [];
    this.messages = new Map();
    this.locks = new Map();
    this.threads = new Map();
    this.threadMessages = new Map();
    this.threadSequence = 0;
  }

  async createRoom(room, runtimeBundle) {
    const externalKey = `${room.platform}:${room.external_room_id}`;
    if (this.external.has(externalKey)) throw new Error(`salon déjà connecté: ${externalKey}`);
    const record = { room: clone(room), runtime_bundle: clone(runtimeBundle) };
    this.rooms.set(room.room_id, record);
    this.external.set(externalKey, room.room_id);
    return clone(record);
  }

  async getRoom(roomId, { tenantId = null } = {}) {
    const record = this.rooms.get(String(roomId || ''));
    if (!record || (tenantId != null && record.room.tenant_id !== String(tenantId))) return null;
    return clone(record);
  }

  async findRoom(platform, externalRoomId) {
    const roomId = this.external.get(`${platform}:${externalRoomId}`);
    return roomId ? this.getRoom(roomId) : null;
  }

  async listRooms({ tenantId = null, platform = null } = {}) {
    return [...this.rooms.values()]
      .filter((record) => tenantId == null || record.room.tenant_id === String(tenantId))
      .filter((record) => !platform || record.room.platform === platform)
      .map(clone);
  }

  async updateRoomActivity(roomId, timestamp) {
    const record = this.rooms.get(String(roomId));
    if (!record) return false;
    record.room.last_activity_at = timestamp;
    record.room.updated_at = timestamp;
    return true;
  }

  async appendEvent(event) {
    const stored = { ...clone(event), sequence: (this.events.at(-1)?.sequence || 0) + 1 };
    this.events.push(stored);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return clone(stored);
  }

  async activity({ tenantId = null, roomId = null, after = 0, limit = 100 } = {}) {
    return this.events
      .filter((event) => event.sequence > Number(after || 0))
      .filter((event) => tenantId == null || event.tenant_id === String(tenantId))
      .filter((event) => !roomId || event.room_id === roomId)
      .slice(-Math.max(1, Math.min(250, Number(limit) || 100)))
      .map(clone);
  }

  async claimMessage({ platform, messageId, tenantId, roomId }) {
    const id = key(tenantId, platform, messageId);
    const existing = this.messages.get(id);
    if (existing?.status === 'completed') return { claimed: false, completed: true, result: clone(existing.result) };
    if (existing?.status === 'processing') return { claimed: false, completed: false, result: null };
    this.messages.set(id, { status: 'processing', tenantId, roomId, result: null });
    return { claimed: true, result: null };
  }

  async completeMessage(platform, messageId, result, tenantId = null) {
    this.messages.set(key(tenantId, platform, messageId), { status: 'completed', result: clone(result) });
  }

  async failMessage(platform, messageId, tenantId = null) {
    this.messages.set(key(tenantId, platform, messageId), { status: 'failed', result: null });
  }

  async withRoomLock(roomId, fn) {
    const previous = this.locks.get(roomId) || Promise.resolve();
    const task = previous.catch(() => {}).then(fn);
    this.locks.set(roomId, task);
    try { return await task; }
    finally { if (this.locks.get(roomId) === task) this.locks.delete(roomId); }
  }

  async createThread(thread) {
    if (this.threads.has(thread.thread_id)) throw new Error(`fil déjà existant: ${thread.thread_id}`);
    this.threads.set(thread.thread_id, clone(thread));
    this.threadMessages.set(thread.thread_id, []);
    return clone(thread);
  }

  async getThread(threadId, { tenantId = null } = {}) {
    const thread = this.threads.get(String(threadId || ''));
    if (!thread || (tenantId != null && thread.tenant_id !== String(tenantId))) return null;
    return { ...clone(thread), messages: clone(this.threadMessages.get(thread.thread_id) || []) };
  }

  async listThreads({ tenantId = null, roomId = null, limit = 100 } = {}) {
    const rows = [...this.threads.values()]
      .filter((thread) => tenantId == null || thread.tenant_id === String(tenantId))
      .filter((thread) => !roomId || thread.room_id === roomId)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, Math.max(1, Math.min(250, Number(limit) || 100)));
    return rows.map((thread) => ({ ...clone(thread), messages: clone(this.threadMessages.get(thread.thread_id) || []) }));
  }

  async updateThread(threadId, patch, { tenantId = null } = {}) {
    const current = this.threads.get(String(threadId || ''));
    if (!current || (tenantId != null && current.tenant_id !== String(tenantId))) return null;
    const next = { ...current, ...clone(patch), thread_id: current.thread_id, tenant_id: current.tenant_id };
    this.threads.set(current.thread_id, next);
    return clone(next);
  }

  async appendThreadMessage(threadId, message, { tenantId = null } = {}) {
    const thread = this.threads.get(String(threadId || ''));
    if (!thread || (tenantId != null && thread.tenant_id !== String(tenantId))) throw new Error('fil introuvable');
    const stored = { ...clone(message), message_id: message.message_id || `threadmsg_${++this.threadSequence}` };
    this.threadMessages.get(thread.thread_id).push(stored);
    thread.updated_at = stored.created_at || new Date().toISOString();
    return clone(stored);
  }
}
