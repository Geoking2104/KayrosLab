import { getEntity } from '../data/ontology.js';
import { useI18n } from '../i18n/I18nContext.jsx';

export default function GapAnalysis({ gaps }) {
  const { t } = useI18n();

  if (!gaps || gaps.length === 0) return null;

  return (
    <div className="gap-section">
      <h3>{t('app.gaps.title')}</h3>
      <p className="gap-subtitle">{t('app.gaps.subtitle')}</p>
      <div className="gap-list">
        {gaps.map((g) => {
          const entity = getEntity(g.neuronId);
          return (
            <span key={g.neuronId} className={`gap-chip ${g.type}`}>
              {g.type === 'advantage' ? '🟢' : '🔴'}
              {(entity?.icon || '') + ' ' + (entity?.name || g.neuronId)}
              <span className="gap-value">{g.diff > 0 ? `+${g.diff}` : g.diff}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
