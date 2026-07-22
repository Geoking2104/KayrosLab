export default function Legend({ competitors }) {
  if (!competitors || competitors.length === 0) return null;

  return (
    <div className="legend">
      <span className="legend-item">
        <span className="swatch" style={{ background: '#6366f1' }} />
        Notre idée
      </span>
      {competitors.map((c) => (
        <span key={c.name} className="legend-item">
          <span className="swatch" style={{ background: c.color }} />
          {c.name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({c.avgScore})</span>
        </span>
      ))}
    </div>
  );
}
