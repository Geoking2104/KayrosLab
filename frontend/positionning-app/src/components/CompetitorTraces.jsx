export default function CompetitorTraces({ traces, competitors }) {
  const active = competitors.filter((c) => {
    const s = traces?.[c.name];
    return s !== undefined && s !== null;
  });

  if (active.length === 0) return null;

  return (
    <div className="competitor-traces">
      {active.map((c) => (
        <span key={c.name} className="trace-dot">
          <span className="dot" style={{ background: c.color }} />
          {traces[c.name]}
        </span>
      ))}
    </div>
  );
}
