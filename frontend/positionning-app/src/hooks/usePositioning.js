import { useState, useCallback, useRef } from 'react';
import { searchCompetitors } from '../collectors/webScanner.js';
import { searchGitHub } from '../collectors/githubScanner.js';
import { scoreAll, computeIdeaBaseline, computeGaps } from '../collectors/scoringProtocol.js';

const COMPETITOR_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899'];

export function usePositioning() {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ web: 0, github: 0, scoring: 0 });
  const [idea, setIdea] = useState('');
  const [baseline, setBaseline] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [error, setError] = useState(null);
  const idCounter = useRef(0);

  const run = useCallback(async (ideaText) => {
    if (!ideaText.trim()) return;
    setIdea(ideaText);
    setStatus('collecting');
    setError(null);
    setProgress({ web: 0, github: 0, scoring: 0 });

    try {
      setProgress((p) => ({ ...p, web: 30 }));
      const webResults = await searchCompetitors(ideaText);
      setProgress((p) => ({ ...p, web: 100 }));

      if (webResults.length === 0) {
        setStatus('done');
        setCompetitors([]);
        setBaseline(computeIdeaBaseline(ideaText));
        return;
      }

      setProgress((p) => ({ ...p, github: 20 }));
      const githubResults = await searchGitHub(ideaText, webResults);
      setProgress((p) => ({ ...p, github: 100 }));

      setProgress((p) => ({ ...p, scoring: 50 }));
      const ideaBase = computeIdeaBaseline(ideaText);
      const scored = scoreAll(ideaText, webResults, githubResults);
      const scoredWithColor = scored.map((c, i) => ({
        ...c,
        id: ++idCounter.current,
        color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
      }));
      const gapList = computeGaps(ideaBase, scoredWithColor);

      setProgress((p) => ({ ...p, scoring: 100 }));
      setBaseline(ideaBase);
      setCompetitors(scoredWithColor);
      setGaps(gapList);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress({ web: 0, github: 0, scoring: 0 });
    setIdea('');
    setBaseline(null);
    setCompetitors([]);
    setGaps([]);
    setError(null);
  }, []);

  return { status, progress, idea, baseline, competitors, gaps, error, run, reset };
}
