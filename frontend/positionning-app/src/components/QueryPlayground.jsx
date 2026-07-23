import { useState, useMemo } from 'react';
import { ENTITY_TYPES, RELATIONSHIPS, getEntity } from '../data/ontology.js';
import { useI18n } from '../i18n/I18nContext.jsx';

const SUGGESTIONS = [
  'Show me all competitors',
  'List all architectures',
  'Show architectures by pattern',
  'How does Architecture connect to Stack?',
  'What entities have a Security relationship?',
  'Show all business entities',
  'How does Go-to-Market target ICP?',
];

export default function QueryPlayground({ competitorList, baseline }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [suggestionIdx, setSuggestionIdx] = useState(0);

  const handleQuery = (q) => {
    const text = (q || query).toLowerCase().trim();
    if (!text) return;
    setSuggestionIdx(0);

    const matchEntity = ENTITY_TYPES.find((e) => text.includes(e.name.toLowerCase()) || text.includes(e.id));
    const matchRel = RELATIONSHIPS.find((r) => text.includes(r.name.toLowerCase()) || (r.from && text.includes(r.from)));
    const matchShowAll = text.includes('show me all') || text.includes('list all') || text.includes('all competitors');

    if (matchShowAll) {
      setResult({
        title: t('app.query.allCompetitors'),
        lines: (competitorList || []).map((c) => ({
          label: c.name,
          value: `${c.avgScore}/100`,
          color: c.color,
        })),
      });
    } else if (matchEntity) {
      const comps = (competitorList || []).map((c) => ({
        label: c.name,
        value: `${c.scores?.[matchEntity.id] ?? '—'}/100`,
        color: c.color,
      }));
      setResult({
        title: `${matchEntity.icon} ${matchEntity.name}`,
        desc: matchEntity.description,
        lines: comps.length > 0 ? comps : [{ label: t('app.query.noScored'), value: '' }],
      });
    } else if (matchRel) {
      const from = getEntity(matchRel.from);
      const to = getEntity(matchRel.to);
      setResult({
        title: `${(from?.icon || '')} ${matchRel.from} → ${matchRel.name} → ${(to?.icon || '')} ${matchRel.to}`,
        desc: matchRel.description,
        lines: [{ label: t('app.inspector.cardinality'), value: matchRel.cardinality }],
      });
    } else {
      setResult({
        title: t('app.query.unrecognized'),
        desc: t('app.query.trySuggestion'),
      });
    }
  };

  const suggestions = useMemo(() => {
    const list = [...SUGGESTIONS];
    if (competitorList?.length > 0) {
      for (const c of competitorList.slice(0, 3)) {
        list.push(`Show ${c.name} scores`);
      }
    }
    return list;
  }, [competitorList]);

  const handleSuggestion = (s) => {
    setQuery(s);
    handleQuery(s);
  };

  return (
    <div className="query-playground">
      <div className="query-header">
        <i className="fa-solid fa-search" />
        <span>{t('app.tabs.query')}</span>
      </div>

      <div className="query-input-row">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleQuery(); }}
          placeholder={t('app.query.placeholder')} 
          className="query-input"
        />
        <button className="query-go" onClick={() => handleQuery()}>Go</button>
      </div>

      <div className="query-suggestions">
        {suggestions.slice(suggestionIdx, suggestionIdx + 4).map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => handleSuggestion(s)}>
            {s}
          </button>
        ))}
        {suggestionIdx + 4 < suggestions.length && (
          <button className="suggestion-more" onClick={() => setSuggestionIdx((i) => i + 1)}>
            +{suggestions.length - suggestionIdx - 4}
          </button>
        )}
      </div>

      {result && (
        <div className="query-result">
          <div className="query-result-title">{result.title}</div>
          {result.desc && <div className="query-result-desc">{result.desc}</div>}
          {result.lines?.map((line, i) => (
            <div key={i} className="query-result-line">
              <span style={{ color: line.color }}>{line.label}</span>
              {line.value && <span className="query-result-value">{line.value}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
