function buildOntologyPanel(map, lang){
  const typeColor = {
    competitor:'#fb7185', capability:'#34d399', regulation:'#fbbf24',
    segment:'#38bdf8', tech:'#a78bfa', concept:'#94a3b8'
  };
  const typeLabels = lang==='en'
    ? {competitor:'Competitor', capability:'Capability', regulation:'Regulation', segment:'Segment', tech:'Tech', concept:'Concept'}
    : {competitor:'Concurrent', capability:'Capacite', regulation:'Regulation', segment:'Segment', tech:'Tech', concept:'Concept'};

  let html = '<div class="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white overflow-hidden shadow-sm">';

  html += '<div class="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-white/80">';
  html += '<div><p class="text-sm font-semibold text-slate-900">'+escapeHtml(t('ontology_card',{},lang))+'</p>';
  html += '<p class="text-[11px] text-slate-500">'+escapeHtml(t('ontology_note',{},lang)).replace(/^\[|\]$/g,'')+'</p></div>';
  html += '<div class="flex flex-wrap gap-1.5 text-[10px]">';
  html += '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">'+map.entities.length+' '+escapeHtml(lang==='en'?'entities':'entites')+'</span>';
  html += '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">'+map.relations.length+' '+escapeHtml(lang==='en'?'links':'liens')+'</span>';
  html += '<span class="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">'+map.gaps.length+' gaps</span>';
  html += '</div></div>';

  html += '<div class="px-4 pt-3 flex flex-wrap gap-2">';
  Object.keys(typeLabels).forEach(function(k){
    if(!map.entities.some(function(e){ return (e.type||'concept')===k; }) && k!=='concept') return;
    html += '<span class="inline-flex items-center gap-1.5 text-[10px] text-slate-600"><span class="w-2.5 h-2.5 rounded-full" style="background:'+typeColor[k]+'"></span>'+escapeHtml(typeLabels[k])+'</span>';
  });
  html += '</div>';

  html += '<div class="px-3 py-2">';
  html += '<svg id="ontology-graph" class="semantic-graph w-full rounded-xl border border-slate-100 bg-slate-50/80" viewBox="0 0 640 360" role="img" aria-label="'+escapeHtml(t('ontology_card',{},lang))+'">'+renderOntologyGraph(map)+'</svg>';
  html += '</div>';

  html += '<div class="px-4 pb-2 flex flex-wrap gap-1.5">';
  map.entities.forEach(function(e){
    const col = typeColor[e.type]||typeColor.concept;
    html += '<span class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"><span class="w-1.5 h-1.5 rounded-full" style="background:'+col+'"></span>'+escapeHtml(e.label)+'</span>';
  });
  html += '</div>';

  if(map.gaps && map.gaps.length){
    html += '<div class="px-4 pb-4 pt-1">';
    html += '<p class="text-xs font-semibold text-violet-800 mb-1">'+escapeHtml(t('ontology_gaps_title',{},lang))+'</p>';
    html += '<p class="text-[11px] text-slate-500 mb-2">'+escapeHtml(t('ontology_select_hint',{},lang))+'</p>';
    html += '<div class="grid sm:grid-cols-2 gap-2">';
    map.gaps.forEach(function(g){
      const selected = (demoState.selectedOntologyGapIds||[]).includes(g.id);
      html += '<button type="button" data-ontology-gap="'+escapeHtml(g.id)+'" class="text-left rounded-xl border p-3 transition '+(selected?'border-violet-400 bg-violet-50 ring-1 ring-violet-300':'border-slate-200 bg-white hover:border-violet-300')+'">';
      html += '<div class="flex items-start gap-2">';
      html += '<span class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center '+(selected?'bg-violet-600 text-white':'bg-slate-100 text-slate-500')+'">'+(selected?'\u2713':'\u25CB')+'</span>';
      html += '<div><div class="text-xs font-semibold text-slate-900">'+escapeHtml(g.label)+'</div>';
      if(g.opportunity) html += '<div class="text-[11px] text-slate-500 mt-1 leading-snug">'+escapeHtml(g.opportunity)+'</div>';
      html += '</div></div></button>';
    });
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}
