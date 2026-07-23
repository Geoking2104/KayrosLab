import { ENTITY_TYPES } from '../data/ontology.js';
import { useI18n } from '../i18n/I18nContext.jsx';

export default function HistoryCompare({ entries, onClose }) {
  const { t } = useI18n();
  if (entries.length !== 2) return null;
  const [a, b] = entries;

  return (
    <div className="history-compare">
      <div className="history-compare-header">
        <h3>{t('app.historyCompare.title')}</h3>
        <button className="btn btn-outline btn-sm" onClick={onClose}>{t('app.historyCompare.close')}</button>
      </div>

      <div className="compare-grid">
        <div className="compare-col">
          <div className="compare-card">
            <p className="compare-idea">{a.idea}</p>
            <div className="compare-meta">{new Date(a.createdAt).toLocaleDateString()}</div>
            {a.ki !== null && <div className="compare-ki">{t('app.historyCompare.ki')} {a.ki}/100</div>}
          </div>
        </div>
        <div className="compare-col">
          <div className="compare-card">
            <p className="compare-idea">{b.idea}</p>
            <div className="compare-meta">{new Date(b.createdAt).toLocaleDateString()}</div>
            {b.ki !== null && <div className="compare-ki">{t('app.historyCompare.ki')} {b.ki}/100</div>}
          </div>
        </div>
      </div>

      <table className="compare-table">
        <thead>
          <tr>
            <th>{t('app.historyCompare.dimension')}</th>
            <th>{a.idea.slice(0, 30)}</th>
            <th>{b.idea.slice(0, 30)}</th>
            <th>{t('app.historyCompare.delta')}</th>
          </tr>
        </thead>
        <tbody>
          {ENTITY_TYPES.map((et) => {
            const scoreA = a.baseline?.[et.id] ?? null;
            const scoreB = b.baseline?.[et.id] ?? null;
            const diff = scoreA !== null && scoreB !== null ? scoreA - scoreB : null;
            return (
              <tr key={et.id}>
                <td>{et.icon && <span>{et.icon}</span>} {et.name}</td>
                <td className={scoreA >= 50 ? 'score-high' : 'score-low'}>{scoreA !== null ? scoreA : '—'}</td>
                <td className={scoreB >= 50 ? 'score-high' : 'score-low'}>{scoreB !== null ? scoreB : '—'}</td>
                <td className={diff !== null ? (diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : '') : ''}>
                  {diff !== null ? (diff > 0 ? `+${diff}` : diff) : '—'}
                </td>
              </tr>
            );
          })}
          <tr className="compare-total">
            <td><strong>{t('app.historyCompare.avgScore')}</strong></td>
            <td>{Math.round(ENTITY_TYPES.reduce((s, et) => s + (a.baseline?.[et.id] ?? 0), 0) / ENTITY_TYPES.length)}</td>
            <td>{Math.round(ENTITY_TYPES.reduce((s, et) => s + (b.baseline?.[et.id] ?? 0), 0) / ENTITY_TYPES.length)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div className="compare-competitors">
        <h4>{t('app.historyCompare.competitors')}</h4>
        <div className="compare-grid">
          <div className="compare-col">
            {a.competitors.map((c) => (
              <div key={c.id || c.name} className="compare-comp">{c.name} — {c.avgScore}</div>
            ))}
            {a.competitors.length === 0 && <span className="text-muted">{t('app.historyCompare.none')}</span>}
          </div>
          <div className="compare-col">
            {b.competitors.map((c) => (
              <div key={c.id || c.name} className="compare-comp">{c.name} — {c.avgScore}</div>
            ))}
            {b.competitors.length === 0 && <span className="text-muted">{t('app.historyCompare.none')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
