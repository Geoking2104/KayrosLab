import { useState, useEffect, useCallback, useMemo } from 'react';
import { completeTour } from '../data/tourStore.js';
import { useI18n } from '../i18n/I18nContext.jsx';

export default function OnboardingTour({ onFinish }) {
  const { t } = useI18n();

  const STEPS = [
  {
    target: '.header',
    title: t('app.onboarding.step1Title'),
    text: t('app.onboarding.step1Desc'),
    placement: 'bottom',
  },
  {
    target: '.idea-input-section',
    title: t('app.onboarding.step2Title'),
    text: t('app.onboarding.step2Desc'),
    placement: 'bottom',
  },
  {
    target: '.ki-banner',
    title: t('app.onboarding.step3Title'),
    text: t('app.onboarding.step3Desc'),
    placement: 'bottom',
    requiresData: true,
  },
  {
    target: '.tabs',
    title: t('app.onboarding.step4Title'),
    text: t('app.onboarding.step4Desc'),
    placement: 'top',
    requiresData: true,
  },
  {
    target: '.graph-area',
    title: t('app.onboarding.step5Title'),
    text: t('app.onboarding.step5Desc'),
    placement: 'left',
    requiresData: true,
  },
  {
    target: '.comp-chips',
    title: t('app.onboarding.step6Title'),
    text: t('app.onboarding.step6Desc'),
    placement: 'top',
    requiresData: true,
  },
  {
    target: '.empty-state',
    title: t('app.onboarding.step7Title'),
    text: t('app.onboarding.step7Desc'),
    placement: 'center',
    skipIfData: true,
  },
];

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

  const filtered = useMemo(() => {
    return STEPS.filter((s) => {
      if (s.requiresData && !hasData) return false;
      if (s.skipIfData && hasData) return false;
      return true;
    });
  }, [STEPS, hasData]);

  useEffect(() => {
    setStep(s => Math.min(s, filtered.length - 1));
  }, [filtered.length]);

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
            <button className="btn-outline btn-xs" onClick={handleSkip}>{t('app.onboarding.skip')}</button>
            <button className="btn btn-primary btn-sm" onClick={handleNext}>
              {isLast ? t('app.onboarding.gotIt') : t('app.onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
