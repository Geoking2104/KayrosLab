const STORE_KEY = 'kayros_history';

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export function listHistory() {
  return load().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function addHistoryEntry({ idea, ki, baseline, competitors, gaps }) {
  const data = load();
  data.push({
    id: crypto.randomUUID(),
    idea,
    ki: ki ?? null,
    baseline: baseline || {},
    competitors: competitors || [],
    gaps: gaps || [],
    createdAt: new Date().toISOString(),
  });
  save(data);
  return data;
}

export function removeHistoryEntry(id) {
  const data = load();
  save(data.filter((e) => e.id !== id));
}

export function clearHistory() {
  save([]);
}

export function getHistoryEntry(id) {
  return load().find((e) => e.id === id) || null;
}
