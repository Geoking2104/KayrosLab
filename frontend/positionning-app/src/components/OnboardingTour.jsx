import { useState, useEffect, useCallback } from 'react';
import { completeTour } from '../data/tourStore.js';

const STEPS = [
  {
    target: '.header',
    title: '👋 Welcome to KayrosLab',
    text: 'Analyze your ideas against competitors using a 14-dimensional ontology (7 tech + 7 business dimensions). Position, compare, and discover gaps.',
    placement: 'bottom',
  },
  {
    target: '.idea-input-section',
    title: '💡 Enter Your Idea',
    text: 'Type or paste your idea here (min 10 characters). Describe your product, startup, or concept in detail for the best analysis.',
    placement: 'bottom',
  },
  {
    target: '.ki-banner',
    title: '📊 Kayros Index',
    text: 'After analysis, this banner shows your KI score (0–100). It measures how well your idea scores across all 14 dimensions compared to competitors.',
    placement: 'bottom',
    requiresData: true,
  },
  {
    target: '.tabs',
    title: '🗂️ Explore the Results',
    text: 'Use the tabs to dive deeper: Graph (ontology visualization), Dashboard, Query (SPARQL), Gaps, Export, Multi, History, Campaigns, and Settings.',
    placement: 'top',
    requiresData: true,
  },
  {
    target: '.graph-area',
    title: '🕸️ Ontology Graph',
    text: 'Each node is a dimension (tech or business). Click a node to inspect details. Select competitors to highlight their scores on the graph.',
    placement: 'left',
    requiresData: true,
  },
  {
    target: '.comp-chips',
    title: '🏢 Competitor Comparison',
    text: 'Click a competitor chip to highlight their scores on the graph. Compare your idea side-by-side with any competitor.',
    placement: 'top',
    requiresData: true,
  },
  {
    target: '.empty-state',
    title: '🚀 Ready to Start?',
    text: 'Enter an idea above and click "Analyze" to begin. The more detail you provide, the richer your analysis will be!',
    placement: 'center',
    skipIfData: true,
  },
];

export default function OnboardingTour({ onFinish }) {
  const [step, setStep] = useState(0);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const check = setInterval(() => {
      setHasData(!!document.querySelector('.ki-banner, .comp-chips'));
    }, 1000);
    return () => clearInterval(check);
  }, []);

  const filtered = STEPS.filter((s) => {
    if (s.requiresData && !hasData) return false;
    if (s.skipIfData && hasData) return false;
    return true;
  });

  const current = filtered[step];
  const isLast = step >= filtered.length - 1;

  const scrollToTarget = useCallback((target) => {
    const el = document.querySelector(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    if (current) scrollToTarget(current.target);
  }, [step, current, scrollToTarget]);

  const handleNext = () => {
    if (isLast) {
      completeTour();
      document.body.style.overflow = '';
      if (onFinish) onFinish();
    } else {
      setStep((s) => Math.min(s + 1, filtered.length - 1));
    }
  };

  const handleSkip = () => {
    completeTour();
    document.body.style.overflow = '';
    if (onFinish) onFinish();
  };

  if (!current) return null;

  const rect = current.target !== 'center' ? document.querySelector(current.target)?.getBoundingClientRect() : null;

  const getTipStyle = () => {
    if (current.placement === 'center') return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    if (!rect) return { position: 'fixed', top: '20px', right: '20px' };
    switch (current.placement) {
      case 'bottom': return { position: 'fixed', top: rect.bottom + 12, left: Math.max(16, rect.left + rect.width / 2 - 190) };
      case 'top': return { position: 'fixed', bottom: window.innerHeight - rect.top + 12, left: Math.max(16, rect.left + rect.width / 2 - 190) };
      case 'left': return { position: 'fixed', top: Math.max(16, rect.top + rect.height / 2 - 80), left: Math.max(16, rect.right + 12) };
      case 'right': return { position: 'fixed', top: Math.max(16, rect.top + rect.height / 2 - 80), left: Math.max(16, rect.left - 380 - 12) };
      default: return { position: 'fixed', top: rect.bottom + 12, left: Math.max(16, rect.left + rect.width / 2 - 190) };
    }
  };

  return (
    <div className="tour-overlay">
      <div className="tour-backdrop" onClick={handleSkip} />

      {rect && current.placement !== 'center' && (
        <div
          className="tour-highlight"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            position: 'fixed',
          }}
        />
      )}

      <div className="tour-tip" style={getTipStyle()}>
        <div className="tour-title">{current.title}</div>
        <p className="tour-text">{current.text}</p>
        <div className="tour-footer">
          <div className="tour-dots">
            {filtered.map((_, i) => (
              <span key={i} className={`tour-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>
          <div className="tour-actions">
            <button className="btn-outline btn-xs" onClick={handleSkip}>Skip all</button>
            <button className="btn btn-primary btn-sm" onClick={handleNext}>
              {isLast ? 'Got it!' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
