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
}
