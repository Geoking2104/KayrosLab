const COLLECTORS = [
  { key: 'web', label: 'Web', color: '#6366f1' },
  { key: 'github', label: 'GitHub / GitLab', color: '#10b981' },
  { key: 'scoring', label: 'Scoring', color: '#f59e0b' },
];

export default function CollectorPanel({ progress, visible }) {
  if (!visible) return null;

  return (
    <div className="collector-panel">
      <h3>Collecte en cours...</h3>
      <div className="collector-list">
        {COLLECTORS.map((c) => (
          <div key={c.key} className="collector-item">
            <span className="name">{c.label}</span>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress[c.key] || 0}%`, background: c.color }}
              />
            </div>
            <span className="status" style={{ color: progress[c.key] >= 100 ? c.color : '#94a3b8' }}>
              {progress[c.key] >= 100 ? '✓ Terminé' : `${progress[c.key] || 0}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
