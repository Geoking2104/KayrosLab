import { useState, useEffect, useMemo } from 'react';
import { listHistory, removeHistoryEntry, clearHistory } from '../data/historyStore.js';
import { useI18n } from '../i18n/I18nContext.jsx';

export default function HistoryList({ onRestore, onCompare }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());

  // useEffect() reads listHistory() from localStorage on mount.
  useEffect(() => { setEntries(listHistory()); }, []);

  const refresh = () => setEntries(listHistory());

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) => e.idea.toLowerCase().includes(q));
  }, [entries, search]);

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= 2) {
        const first = next.values().next().value;
        next.delete(first);
      }
      next.add(id);
    }
    setSelected(next);
  };

  return (
    <div className="history-list">
      <div className="history-header">
        <h3>{t('app.history.tab')} ({entries.length})</h3>
        <div className="history-actions">
          <button className="btn btn-outline btn-sm" onClick={refresh}>↻</button>
          {entries.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => { if (confirm(t('app.history.confirmClear'))) { clearHistory(); refresh(); } }}>{t('app.history.clearAll')}</button>
          )}
        </div>
      </div>

      {entries.length > 5 && (
        <input
          type="text"
          className="history-search"
          placeholder={t('app.history.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {selected.size === 2 && (
        <button className="btn btn-primary btn-sm mb-8" onClick={() => onCompare([...selected])}>
          {t('app.history.compare')}
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="history-empty">
          {search ? t('app.history.noResults') : t('app.history.empty')}
        </div>
      ) : (
        <div className="history-entries">
          {filtered.map((e) => (
            <div key={e.id} className={`history-card ${selected.has(e.id) ? 'selected' : ''}`}>
              <button
                className="btn btn-primary btn-xs history-restore-button"
                onClick={(ev) => { ev.stopPropagation(); onRestore(e); }}
                title={t('app.history.restore')}
              >{t('app.history.restore')}</button>
              <div className="history-card-left">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggleSelect(e.id)}
                  onClick={(ev) => ev.stopPropagation()}
                />
                <div className="history-card-body">
                  <p className="history-idea">{e.idea}</p>
                  <div className="history-meta">
                    <span>{new Date(e.createdAt).toLocaleString()}</span>
                    <span>{e.competitors.length} {t('app.history.competitors')}</span>
                  </div>
                </div>
              </div>
              <div className="history-card-right">
                {e.ki !== null && <span className="history-ki">{e.ki}/100</span>}
                <button
                  className="btn-outline btn-xs"
                  onClick={(ev) => { ev.stopPropagation(); removeHistoryEntry(e.id); refresh(); }}
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}