export default function ScoreBar({ score, color }) {
  return (
    <div className="score-bar-bg">
      <div
        className="score-bar-fill"
        style={{ width: `${score}%`, background: color || '#6366f1' }}
      />
    </div>
  );
}
