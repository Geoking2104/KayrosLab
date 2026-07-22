import { useState } from 'react';

export default function IdeaInput({ onAnalyze, loading }) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (value.trim() && !loading) onAnalyze(value.trim());
  };

  return (
    <div className="idea-input-section">
      <label htmlFor="idea-input">Décrivez votre idée, concept ou positionnement</label>
      <div className="idea-input-row">
        <textarea
          id="idea-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Ex : "Plateforme IA souveraine pour le diagnostic médical vétérinaire"'
          disabled={loading}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
        />
        <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !value.trim()}>
          {loading ? 'Analyse...' : 'Analyser'}
        </button>
      </div>
    </div>
  );
}
