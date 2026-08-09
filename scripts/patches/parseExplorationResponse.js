function parseExplorationResponse(raw,round){
  const parsed=extractJsonValue(raw);
  let values=Array.isArray(parsed)?parsed:(parsed.candidates||parsed.variants||parsed.directions||parsed.hypotheses||parsed.pistes||parsed.options||[]);
  if(!Array.isArray(values)) values=[];
  if(!values.length){
    const text=String(raw||'');
    const lines=text.split(/\n+/).map(l=>l.replace(/^[\s\-\*\d\.\)\(]+/,'').trim()).filter(l=>l.length>20 && l.length<280);
    values=lines.slice(0,3).map(function(line,i){ return { title:'Piste '+(i+1), reframedIdea:line, firstExperiment:'Clarifier cette piste avec l\'utilisateur', falsifiableHypothesis:line }; });
  }
  if(!values.length) throw new Error(t('exploration_parse_error'));
  const candidates=values.slice(0,3).map((value,index)=>normalizeIdeaCandidate(value,index,round));
  candidates.forEach(function(c,i){
    if(!c.reframedIdea) c.reframedIdea=c.title||('Direction '+(i+1));
    if(!c.falsifiableHypothesis) c.falsifiableHypothesis=c.reframedIdea;
    if(!c.firstExperiment) c.firstExperiment=(cycleLanguage()==='en'
      ? 'Interview 3 target users to check whether this hypothesis holds'
      : 'Interviewer 3 utilisateurs cibles pour verifier si cette hypothese tient');
  });
  while(candidates.length<3){
    const n=candidates.length+1;
    const lang=cycleLanguage();
    candidates.push(normalizeIdeaCandidate({
      title: lang==='en' ? ('Clarifying path '+n) : ('Piste de clarification '+n),
      reframedIdea: lang==='en'
        ? 'We need a sharper definition of the beneficiary, the constraint, and the success metric before ranking further.'
        : 'Il faut preciser le beneficiaire, la contrainte et la metrique de succes avant de continuer le ranking.',
      falsifiableHypothesis: lang==='en'
        ? 'Without a named beneficiary and measurable success, the idea remains too broad to stress-test.'
        : 'Sans beneficiaire nomme et succes mesurable, l\'idee reste trop large pour etre eprouvee.',
      firstExperiment: lang==='en'
        ? 'Answer the clarification questions below, then regenerate the novelty loop.'
        : 'Repondre aux questions de clarification ci-dessous, puis relancer la boucle de nouveaute.',
      criticalUnknowns: lang==='en'
        ? ['Who is the primary beneficiary?', 'What constraint is non-negotiable?', 'What would count as success in 90 days?']
        : ['Qui est le beneficiaire principal ?', 'Quelle contrainte est non negociable ?', 'Quel succes mesurable a 90 jours ?'],
      scores:{ novelty:5, relevance:6, testability:7 }
    }, candidates.length, round));
  }
  return candidates;
}
