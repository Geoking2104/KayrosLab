function buildOntologyPanel(map, lang){
  const typeColor = {
    competitor:'#fb7185', capability:'#34d399', regulation:'#fbbf24',
    segment:'#38bdf8', tech:'#a78bfa', concept:'#94a3b8'
  };
  const isEn = lang==='en';
  const typeMeta = isEn ? {
    competitor:{label:'Competitor', hint:'Players already on the same ground'},
    capability:{label:'Capability', hint:'Skills or assets you can mobilize'},
    regulation:{label:'Regulation', hint:'Rules that constrain or enable'},
    segment:{label:'Segment', hint:'Who is served or targeted'},
    tech:{label:'Tech', hint:'Technical building blocks'},
    concept:{label:'Concept', hint:'Other structuring idea'}
  } : {
    competitor:{label:'Concurrent', hint:'Acteurs deja presents sur le meme terrain'},
    capability:{label:'Capacite', hint:'Savoir-faire ou actifs mobilisables'},
    regulation:{label:'Regulation', hint:'Regles qui contraignent ou autorisent'},
    segment:{label:'Segment', hint:'Publics servis ou cibles'},
    tech:{label:'Tech', hint:'Briques techniques mobilisees'},
    concept:{label:'Concept', hint:'Autre idee structurante'}
  };
  const relMeta = isEn ? {
    competes_with:'Competes with', enables:'Enables', constrains:'Constrains',
    serves:'Serves', diverges_from:'Diverges from', drives:'Drives', related:'Related'
  } : {
    competes_with:'Rivalise avec', enables:'Permet', constrains:'Contraint',
    serves:'Sert', diverges_from:'Diverge de', drives:'Pousse', related:'Relie a'
  };
  const copy = isEn ? {
    title: t('ontology_card',{},lang) || 'Competitive radar and gap analysis',
    subtitle: 'Read the map like a strategic network: clusters, links, then gaps to connect.',
    howTitle: 'How to read this radar',
    how: ['Colored nodes = entities (size = connections).','Color groups = entity type.','Solid lines = structural links; dashed violet = tension.','Select 1-3 gaps below to steer Challenge and Decide.'],
    legendTitle: 'Entity types',
    linksTitle: 'Link types present',
    entitiesTitle: 'Entities on the map',
    gapsTitle: t('ontology_gaps_title',{},lang) || 'Topics to connect',
    gapsHint: t('ontology_select_hint',{},lang) || 'Select gaps to inject into the next steps.',
    statsE: 'entities', statsL: 'links', statsG: 'gaps',
    emptyGaps: 'No structural gap detected - still pick a tension to stress-test.'
  } : {
    title: t('ontology_card',{},lang) || 'Radar concurrentiel et gap analysis',
    subtitle: 'Lisez la carte comme un reseau strategique : clusters, liens, puis gaps a connecter.',
    howTitle: 'Comment lire ce radar',
    how: ['Noeuds colores = entites (taille = connexions).','Couleur = type d entite.','Traits pleins = liens structurants ; pointilles violet = tension.','Selectionnez 1 a 3 gaps pour orienter Eprouver et Arbitrer.'],
    legendTitle: 'Types d entites',
    linksTitle: 'Types de liens presents',
    entitiesTitle: 'Entites sur la carte',
    gapsTitle: t('ontology_gaps_title',{},lang) || 'Topics to connect - gaps',
    gapsHint: t('ontology_select_hint',{},lang) || 'Ces gaps seront injectes dans Challenge et Decide.',
    statsE: 'entites', statsL: 'liens', statsG: 'gaps',
    emptyGaps: 'Aucun gap structurel detecte - choisissez tout de meme une tension a eprouver.'
  };

  let html = '<div class="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white overflow-hidden shadow-sm">';
  html += '<div class="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-white/90">';
  html += '<div><p class="text-sm font-semibold text-slate-900">'+escapeHtml(copy.title)+'</p>';
  html += '<p class="text-[11px] text-slate-500 mt-0.5">'+escapeHtml(copy.subtitle)+'</p></div>';
  html += '<div class="flex flex-wrap gap-1.5 text-[10px]">';
  html += '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">'+map.entities.length+' '+escapeHtml(copy.statsE)+'</span>';
  html += '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">'+map.relations.length+' '+escapeHtml(copy.statsL)+'</span>';
  html += '<span class="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">'+map.gaps.length+' '+escapeHtml(copy.statsG)+'</span>';
  html += '</div></div>';

  // Color legend strip (always visible)
  html += '<div class="px-4 py-3 border-b border-slate-100 bg-white">';
  html += '<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">'+escapeHtml(isEn?'Color legend':'Legende des couleurs')+'</p>';
  html += '<div class="flex flex-wrap gap-x-4 gap-y-2">';
  const legendItems = isEn
    ? [['competitor','Competitor','#fb7185'],['capability','Capability','#34d399'],['regulation','Regulation','#fbbf24'],['segment','Segment','#38bdf8'],['tech','Tech','#a78bfa'],['concept','Concept','#94a3b8']]
    : [['competitor','Concurrent','#fb7185'],['capability','Capacite','#34d399'],['regulation','Regulation','#fbbf24'],['segment','Segment','#38bdf8'],['tech','Tech','#a78bfa'],['concept','Concept','#94a3b8']];
  legendItems.forEach(function(item){
    html += '<span class="inline-flex items-center gap-1.5 text-[11px] text-slate-700">';
    html += '<span class="w-3 h-3 rounded-full border border-white shadow-sm flex-shrink-0" style="background:'+item[2]+'"></span>';
    html += '<span class="font-medium">'+escapeHtml(item[1])+'</span></span>';
  });
  html += '</div>';
  html += '<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-600">';
  html += '<span class="inline-flex items-center gap-1.5"><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="#94a3b8" stroke-width="2"/></svg>'+escapeHtml(isEn?'Structural link':'Lien structurant')+'</span>';
  html += '<span class="inline-flex items-center gap-1.5"><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="4 3"/></svg>'+escapeHtml(isEn?'Tension (compete / constrain / diverge)':'Tension (rivalite / contrainte / divergence)')+'</span>';
  html += '<span class="inline-flex items-center gap-1.5"><span class="inline-flex items-end gap-0.5"><span class="w-2 h-2 rounded-full bg-sky-400"></span><span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span><span class="w-3.5 h-3.5 rounded-full bg-sky-400"></span></span>'+escapeHtml(isEn?'Node size = links':'Taille = liens')+'</span>';
  html += '</div></div>';

  html += '<details open class="px-4 py-3 border-b border-slate-100 bg-sky-50/40">';
  html += '<summary class="cursor-pointer text-xs font-semibold text-sky-900 select-none">'+escapeHtml(copy.howTitle)+'</summary>';
  html += '<ol class="mt-2 space-y-1.5 text-[11px] text-slate-600 list-decimal pl-4 leading-relaxed">';
  copy.how.forEach(function(line){ html += '<li>'+escapeHtml(line)+'</li>'; });
  html += '</ol></details>';

  html += '<div class="px-4 pt-3">';
  html += '<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">'+escapeHtml(copy.legendTitle)+'</p>';
  html += '<div class="grid sm:grid-cols-2 gap-1.5 mb-3">';
  Object.keys(typeMeta).forEach(function(k){
    const used = map.entities.some(function(e){ return (e.type||'concept')===k; });
    if(!used && k!=='concept') return;
    const m = typeMeta[k];
    html += '<div class="flex items-start gap-2 text-[11px] text-slate-600"><span class="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:'+typeColor[k]+'"></span><span><span class="font-semibold text-slate-800">'+escapeHtml(m.label)+'</span> - '+escapeHtml(m.hint)+'</span></div>';
  });
  html += '</div></div>';

  const relTypes = [];
  map.relations.forEach(function(r){
    const k = r.type||'related';
    if(relTypes.indexOf(k)<0) relTypes.push(k);
  });
  if(relTypes.length){
    html += '<div class="px-4 pb-2">';
    html += '<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">'+escapeHtml(copy.linksTitle)+'</p>';
    html += '<div class="flex flex-wrap gap-1.5">';
    relTypes.forEach(function(k){
      html += '<span class="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">'+escapeHtml(relMeta[k]||k.replace(/_/g,' '))+'</span>';
    });
    html += '</div></div>';
  }

  html += '<div class="px-3 py-2">';
  html += '<div id="ontology-d3-root" class="w-full min-h-[420px]"></div>';
  html += '</div>';

  html += '<div class="px-4 pb-2">';
  html += '<p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">'+escapeHtml(copy.entitiesTitle)+'</p>';
  html += '<div class="flex flex-wrap gap-1.5">';
  map.entities.forEach(function(e){
    const col = typeColor[e.type]||typeColor.concept;
    const tip = (typeMeta[e.type]||typeMeta.concept).label;
    html += '<span title="'+escapeHtml(tip)+'" class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"><span class="w-1.5 h-1.5 rounded-full" style="background:'+col+'"></span>'+escapeHtml(e.label)+'</span>';
  });
  html += '</div></div>';

  html += '<div class="px-4 pb-4 pt-1">';
  html += '<p class="text-xs font-semibold text-violet-800 mb-1">'+escapeHtml(copy.gapsTitle)+'</p>';
  html += '<p class="text-[11px] text-slate-500 mb-2">'+escapeHtml(copy.gapsHint)+'</p>';
  if(map.gaps && map.gaps.length){
    html += '<div class="grid sm:grid-cols-2 gap-2">';
    map.gaps.forEach(function(g, gi){
      const selected = (demoState.selectedOntologyGapIds||[]).includes(g.id);
      html += '<button type="button" data-ontology-gap="'+escapeHtml(g.id)+'" class="text-left rounded-xl border p-3 transition '+(selected?'border-violet-400 bg-violet-50 ring-1 ring-violet-300':'border-slate-200 bg-white hover:border-violet-300')+'">';
      html += '<div class="flex items-start gap-2">';
      html += '<span class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center '+(selected?'bg-violet-600 text-white':'bg-slate-100 text-slate-500')+'">'+(selected?'Y':String(gi+1))+'</span>';
      html += '<div><div class="text-xs font-semibold text-slate-900">'+escapeHtml(g.label)+'</div>';
      if(g.opportunity) html += '<div class="text-[11px] text-slate-500 mt-1 leading-snug"><span class="font-medium text-violet-700">'+(isEn?'Opportunity':'Opportunite')+' - </span>'+escapeHtml(g.opportunity)+'</div>';
      html += '</div></div></button>';
    });
    html += '</div>';
  } else {
    html += '<p class="text-[11px] text-slate-500 italic">'+escapeHtml(copy.emptyGaps)+'</p>';
  }
  html += '</div></div>';
  return html;
}
