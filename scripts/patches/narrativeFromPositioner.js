function narrativeFromPositioner(raw){
  let text = String(raw||'').trim();
  text = text.replace(/```(?:json)?[\s\S]*?```/gi, ' ').trim();
  const jsonIdx = text.search(/\{\s*"entities"\s*:/);
  if(jsonIdx >= 0) text = text.slice(0, jsonIdx).trim();
  else {
    const matches = text.match(/\{[\s\S]*\}$/);
    if(matches && /"entities"\s*:/.test(matches[0])) {
      text = text.slice(0, text.length - matches[0].length).trim();
    }
  }
  text = text.replace(/^\s*(JSON|Ontology|Ontologie)\s*:?\s*$/gmi, '').trim();
  if(!text || text.length < 40){
    const lang = cycleLanguage();
    return lang==='en'
      ? 'Positioning map generated below. Select one or more structural gaps to steer Challenge and Decide.'
      : 'Carte de positionnement generee ci-dessous. Selectionnez un ou plusieurs gaps structurels pour orienter Eprouver et Arbitrer.';
  }
  return text;
}
