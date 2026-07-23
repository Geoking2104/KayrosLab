import { useState, useMemo } from 'react';
import { ENTITY_TYPES } from '../data/ontology.js';

async function runAll(ideas, runAnalysis, gapThreshold, apiKey, onProgress) {
  const results = [];
  const queue = [...ideas];
  let active = 0;
  const maxConcurrent = 3;

  return new Promise((resolve) => {
    const next = () => {
      while (active < maxConcurrent && queue.length > 0) {
        const idea = queue.shift();
        active++;
        runAnalysis(idea, { gapThreshold, apiKey })
          .then((r) => results.push({ idea, ...r }))
          .catch(() => results.push({ idea, baseline: {}, competitors: [], gaps: [], kayrosIndex: null, error: true }))
          .finally(() => {
            active--;
            onProgress(results.length, ideas.length);
            next();
          });
      }
      if (active === 0 && queue.length === 0) resolve(results);
    };
    next();
  });
}

export default function MultiIdeaAnalysis({ runAnalysis, gapThreshold, apiKey, toast }) {
  const [raw, setRaw] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sortBy, setSortBy] = useState('ki');

  const ideas = useMemo(
    () => raw.split('\n').map((s) => s.trim()).filter((s) => s.length >= 10),
    [raw],
  );

  const handleAnalyzeAll = async () => {
    if (ideas.length === 0) return;
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: ideas.length });
    const res = await runAll(ideas, runAnalysis, gapThreshold, apiKey, (done, total) => {
      setProgress({ done, total });
    });
    setResults(res);
    setRunning(false);
    toast(`Analysis complete: ${res.filter((r) => !r.error).length}/${res.length} succeeded`, { type: 'success' });
  };

  const sorted = useMemo(() => {
    const list = [...results];
    if (sortBy === 'ki') list.sort((a, b) => (b.kayrosIndex ?? -1) - (a.kayrosIndex ?? -1));
    else if (sortBy === 'name') list.sort((a, b) => a.idea.localeCompare(b.idea));
    return list;
  }, [results, sortBy]);

  const bestKi = useMemo(() => Math.max(...results.map((r) => r.kayrosIndex ?? -1), -1), [results]);

  return (
    <div className="multi-idea">
      <h3>Multi-Idea Analysis</h3>
      <p className="multi-hint">Enter one idea per line (min 10 chars each). Up to 10 ideas.</p>

      <textarea
        className="multi-input"
        rows={6}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={'AI-native coding assistant for enterprises\nOpen-source LLM fine-tuning platform\nPrivacy-first medical diagnosis AI'}
        disabled={running}
      />

      <button
        className="btn btn-primary"
        onClick={handleAnalyzeAll}
        disabled={running || ideas.length === 0 || ideas.length > 10}
      >
        {running ? `Analyzing ${progress.done}/${progress.total}...` : `Analyze ${ideas.length} idea${ideas.length > 1 ? 's' : ''}`}
      </button>

      {running && (
        <div className="multi-progress">
          <div className="multi-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="multi-sort">
            <span>Sort: </span>
            <button className={`btn-outline btn-xs ${sortBy === 'ki' ? 'active' : ''}`} onClick={() => setSortBy('ki')}>KI Score</button>
            <button className={`btn-outline btn-xs ${sortBy === 'name' ? 'active' : ''}`} onClick={() => setSortBy('name')}>Name</button>
          </div>

          <div className="multi-results">
            {sorted.map((r, i) => (
              <div key={i} className={`multi-card ${r.kayrosIndex === bestKi && bestKi > 0 ? 'winner' : ''} ${r.error ? 'error' : ''}`}>
                <div className="multi-card-header">
                  <span className="multi-rank">{i === 0 && bestKi > 0 ? '🥇' : `#${i + 1}`}</span>
                  <span className="multi-idea-text">{r.idea}</span>
                  <span className="multi-ki">{r.kayrosIndex !== null ? `${r.kayrosIndex}/100` : '—'}</span>
                </div>
                {!r.error && r.kayrosIndex !== null && (
                  <div className="multi-scores">
                    {ENTITY_TYPES.map((et) => {
                      const score = r.baseline?.[et.id] ?? null;
                      return (
                        <div key={et.id} className="multi-score" title={`${et.name}: ${score ?? '—'}`}>
                          <span className="multi-score-icon">{et.icon}</span>
                          <span className={`multi-score-val ${score >= 50 ? 'high' : 'low'}`}>{score ?? '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {r.error && <p className="multi-error-msg">Analysis failed</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
