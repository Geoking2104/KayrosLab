import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

const MAX_CHARS = 2000;

export default function IdeaInput({ onAnalyze, loading }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const trimmed = value.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= MAX_CHARS;
  const showError = touched && !loading && !valid && trimmed.length > 0;

  const handleSubmit = () => {
    setTouched(true);
    if (valid && !loading) onAnalyze(trimmed);
  };

  return (
    <div className="idea-input-section">
      <label htmlFor="idea-input">{t('app.analyzeInput.label')}</label>
      <div className="idea-input-row">
        <textarea
          ref={textareaRef}
          id="idea-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('app.analyzeInput.placeholder')}
          disabled={loading}
          maxLength={MAX_CHARS}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          onBlur={() => setTouched(true)}
        />
        <div className="idea-actions">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !valid}>
            {loading ? t('app.analyzing') : t('app.analyze')}
          </button>
          <span className={`char-count ${value.length > MAX_CHARS * 0.9 ? 'char-warn' : ''}`}>
            {value.length}/{MAX_CHARS}
          </span>
        </div>
      </div>
      {showError && <p className="field-error">{t('app.analyzeInput.minLength')} ({trimmed.length}/10)</p>}
    </div>
  );
}
