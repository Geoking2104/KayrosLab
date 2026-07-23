import { RELATIONSHIPS } from '../data/ontology.js';
import { useI18n } from '../i18n/I18nContext.jsx';

const TYPE_LABELS = { string: 'string', integer: 'int', decimal: 'decimal', boolean: 'bool', enum: 'enum' };
const TYPE_COLORS = { string: '#6366f1', integer: '#f59e0b', decimal: '#10b981', boolean: '#ef4444', enum: '#8b5cf6' };

export default function InspectorPanel({ entity, competitor, competitorList, baseline, onClose }) {
  const { t } = useI18n();

  if (!entity) {
    return (
      <div className="inspector-empty">
        <div className="inspector-icon">🔍</div>
        <p>{t('app.graph.clickHint')}</p>
        <p className="inspector-hint">{t('app.graph.selectHint')}</p>
      </div>
    );
  }

  const relsFrom = RELATIONSHIPS.filter((r) => r.from === entity.id);
  const relsTo = RELATIONSHIPS.filter((r) => r.to === entity.id);

  return (
    <div className="inspector-panel">
      <div className="inspector-header" style={{ borderLeftColor: entity.color }}>
        <span className="inspector-icon-large">{entity.icon}</span>
        <div>
          <div className="inspector-title">{entity.name}</div>
          <div className="inspector-desc">{entity.description}</div>
        </div>
        <button className="inspector-close" onClick={onClose}>✕</button>
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">{t('app.inspector.properties')}</div>
        {entity.properties.map((prop) => {
          const val = competitor?.scores?.[entity.id] ?? null;
          const ourVal = baseline?.[entity.id] ?? null;
          const diff = (val !== null && ourVal !== null) ? val - ourVal : null;
          return (
            <div key={prop.name} className="inspector-prop">
              <div className="inspector-prop-head">
                <span className="inspector-prop-name">{prop.name}</span>
                <span className="inspector-prop-type" style={{ background: TYPE_COLORS[prop.type], color: '#fff' }}>
                  {TYPE_LABELS[prop.type] || prop.type}
                </span>
                {prop.isIdentifier && <span className="inspector-id-badge">🔑 ID</span>}
              </div>
              {prop.values && (
                <div className="inspector-prop-values">
                  {t('app.inspector.values')} : {prop.values.map((v) => <code key={v}>{v}</code>)}
                </div>
              )}
              {competitor && (
                <div className="inspector-binding">
                  <span style={{ color: competitor.color }}>{competitor.name}</span>
                  <span className="inspector-binding-score">{val ?? '—'}</span>
                  {diff !== null && (
                    <span className={diff >= 0 ? 'diff-positive' : 'diff-negative'}>
                      {diff > 0 ? `+${diff}` : diff}
                    </span>
                  )}
                </div>
              )}
              {!competitor && baseline && (
                <div className="inspector-binding">
                  <span>{t('app.ourIdea')}</span>
                  <span className="inspector-binding-score">{ourVal ?? '—'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">{t('app.inspector.relations')}</div>
        {relsFrom.length === 0 && relsTo.length === 0 && (
          <div className="inspector-empty-rel">{t('app.inspector.noRelations')}</div>
        )}
        {relsFrom.map((r) => (
          <div key={r.id} className="inspector-rel">
            <span className="rel-dir">→</span>
            <span><strong>{r.name}</strong> → {r.to}</span>
            <span className="rel-card">{r.cardinality}</span>
          </div>
        ))}
        {relsTo.map((r) => (
          <div key={r.id} className="inspector-rel">
            <span className="rel-dir">←</span>
            <span><strong>{r.name}</strong> {t('app.inspector.relationshipFrom')} {r.from}</span>
            <span className="rel-card">{r.cardinality}</span>
          </div>
        ))}
      </div>

      {competitorList && competitorList.length > 0 && (
        <div className="inspector-section">
          <div className="inspector-section-title">{t('app.inspector.instances')}</div>
          {competitorList.map((c) => {
            const score = c.scores?.[entity.id];
            return (
              <div key={c.name} className="inspector-instance" style={{ borderLeftColor: c.color }}>
                <span>{c.name}</span>
                <span className={score >= 50 ? 'score-high' : 'score-low'}>{score ?? '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
