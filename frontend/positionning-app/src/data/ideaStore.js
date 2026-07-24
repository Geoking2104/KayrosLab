const STORE_KEY = 'kayros_ideas';
const WIP_WARNING_THRESHOLD = 10;

export const STAGES = ['recueillir', 'ecouter', 'cartographier', 'construire', 'eprouver', 'arbitrer', 'projeter', 'realiser'];

export const STATUSES = ['nouveau', 'en_revue', 'discussion', 'en_developpement', 'termine', 'non_poursuivi', 'consideration_future', 'en_pause'];

export const TERMINAL_STATUSES = ['termine', 'non_poursuivi'];
export const DORMANT_STATUSES = ['consideration_future', 'en_pause', 'non_poursuivi'];

const isValidStage = (s) => STAGES.includes(s);
const isValidStatus = (s) => STATUSES.includes(s);

let listeners = [];
let snapshot = [];

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(ideas) {
  localStorage.setItem(STORE_KEY, JSON.stringify(ideas));
  snapshot = ideas;
  for (const fn of listeners) fn();
}

function notify() { for (const fn of listeners) fn(); }

function genId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `idea_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const nowIso = () => new Date().toISOString();

export function createIdea({ title, author = null, ki = null, scores = null, competitors = [], stage = 'recueillir', status = 'nouveau' }) {
  if (!title) throw new Error('createIdea: title requis');
  if (!isValidStage(stage)) throw new Error(`createIdea: stage invalide "${stage}"`);
  if (!isValidStatus(status)) throw new Error(`createIdea: status invalide "${status}"`);
  const t = nowIso();
  const idea = {
    id: genId(), title, author, ki, scores, competitors,
    stage, status, category: 'general',
    createdAt: t, updatedAt: t,
    history: [{ type: 'created', stage, status, ts: t }],
  };
  const ideas = load();
  ideas.push(idea);
  persist(ideas);
  return idea;
}

export function moveIdea(ideaId, newStage) {
  if (!isValidStage(newStage)) return { ok: false, error: `Stage invalide "${newStage}"` };
  const ideas = load();
  const idx = ideas.findIndex((i) => i.id === ideaId);
  if (idx === -1) return { ok: false, error: 'Idée introuvable' };
  const idea = ideas[idx];
  if (idea.stage === newStage) return { ok: true };
  const t = nowIso();
  ideas[idx] = {
    ...idea, stage: newStage, updatedAt: t,
    history: [...idea.history, { type: 'stage', from: idea.stage, to: newStage, by: 'user', ts: t }],
  };
  persist(ideas);
  return { ok: true };
}

export function updateStatus(ideaId, newStatus) {
  if (!isValidStatus(newStatus)) return { ok: false, error: `Statut invalide "${newStatus}"` };
  const ideas = load();
  const idx = ideas.findIndex((i) => i.id === ideaId);
  if (idx === -1) return { ok: false, error: 'Idée introuvable' };
  const idea = ideas[idx];
  if (idea.status === newStatus) return { ok: true };
  const t = nowIso();
  ideas[idx] = {
    ...idea, status: newStatus, updatedAt: t,
    history: [...idea.history, { type: 'status', from: idea.status, to: newStatus, by: 'user', ts: t }],
  };
  persist(ideas);
  return { ok: true };
}

export function deleteIdea(ideaId) {
  const ideas = load().filter((i) => i.id !== ideaId);
  persist(ideas);
}

export function listIdeas() { return load(); }

export function getIdeasByStage() {
  const ideas = load();
  const map = {};
  for (const s of STAGES) map[s] = [];
  for (const idea of ideas) {
    if (map[idea.stage]) map[idea.stage].push(idea);
  }
  return map;
}

export function getWipWarnings() {
  const byStage = getIdeasByStage();
  const warnings = {};
  for (const [stage, ideas] of Object.entries(byStage)) {
    if (ideas.length >= WIP_WARNING_THRESHOLD) warnings[stage] = ideas.length;
  }
  return warnings;
}

export function subscribe(fn) {
  listeners = [...listeners, fn];
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function getSnapshot() {
  if (snapshot.length === 0 && typeof window !== 'undefined') snapshot = load();
  return snapshot;
}

export function addFromAnalysis({ title, author, ki, scores, competitors }) {
  return createIdea({ title, author: author || 'User', ki, scores, competitors, stage: 'recueillir', status: 'nouveau' });
}
