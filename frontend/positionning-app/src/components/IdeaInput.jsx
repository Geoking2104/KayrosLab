import { useState, useRef, useEffect } from 'react';

const MAX_CHARS = 2000;

export default function IdeaInput({ onAnalyze, loading }) {
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
      <label htmlFor="idea-input">Décrivez votre idée, concept ou positionnement à analyser</label>
      <div className="idea-input-row">
        <textarea
          ref={textareaRef}
          id="idea-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Ex : "Plateforme IA souveraine pour le diagnostic médical vétérinaire"'
          disabled={loading}
          maxLength={MAX_CHARS}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          onBlur={() => setTouched(true)}
        />
        <div className="idea-actions">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !valid}>
            {loading ? 'Analyse en cours...' : 'Analyser'}
          </button>
          <span className={`char-count ${value.length > MAX_CHARS * 0.9 ? 'char-warn' : ''}`}>
            {value.length}/{MAX_CHARS}
          </span>
        </div>
      </div>
      {showError && <p className="field-error">Minimum 10 caractères requis ({trimmed.length}/10)</p>}
    </div>
  );
}
