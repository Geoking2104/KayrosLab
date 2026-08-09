function mountOntologyD3(map, container){
  if(!container || !map || !map.entities || !window.d3){
    if(container && map && !window.d3){
      container.innerHTML = '<svg class="semantic-graph w-full" viewBox="0 0 640 360">'+renderOntologyGraph(map)+'</svg>';
    }
    return;
  }
  const width = container.clientWidth || 640;
  const height = 400;
  const typeColor = {
    competitor:'#fb7185', capability:'#34d399', regulation:'#fbbf24',
    segment:'#38bdf8', tech:'#a78bfa', concept:'#94a3b8'
  };
  const isEn = cycleLanguage()==='en';
  const relLabel = function(t){
    const fr = {competes_with:'rivalise', enables:'permet', constrains:'contraint', serves:'sert', diverges_from:'diverge', drives:'pousse', related:'relie'};
    const en = {competes_with:'competes', enables:'enables', constrains:'constrains', serves:'serves', diverges_from:'diverges', drives:'drives', related:'related'};
    const m = isEn ? en : fr;
    return m[t] || String(t||'').replace(/_/g,' ');
  };

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('viewBox', [0, 0, width, height])
    .attr('width', '100%')
    .attr('height', height)
    .attr('class', 'semantic-graph rounded-xl border border-slate-100 bg-slate-50/80')
    .style('cursor', 'grab');

  const gRoot = svg.append('g');

  svg.call(d3.zoom().scaleExtent([0.4, 2.5]).on('zoom', function(event){
    gRoot.attr('transform', event.transform);
  }));

  const degree = {};
  map.entities.forEach(function(e){ degree[e.id] = 1; });
  (map.relations||[]).forEach(function(r){
    degree[r.from] = (degree[r.from]||1) + 1;
    degree[r.to] = (degree[r.to]||1) + 1;
  });

  const nodes = map.entities.map(function(e){
    return {
      id: e.id,
      label: e.label,
      type: e.type || 'concept',
      color: typeColor[e.type] || typeColor.concept,
      degree: degree[e.id] || 1
    };
  });
  const idSet = {};
  nodes.forEach(function(n){ idSet[n.id] = true; });
  const links = (map.relations||[]).filter(function(r){
    return idSet[r.from] && idSet[r.to];
  }).map(function(r){
    return {
      source: r.from,
      target: r.to,
      type: r.type || 'related',
      tension: /diverges|competes|constrains/.test(r.type||'')
    };
  });

  svg.append('defs').selectAll('marker')
    .data(['link','tension'])
    .join('marker')
    .attr('id', function(d){ return 'arrow-'+d; })
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 18)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('fill', function(d){ return d==='tension' ? '#8b5cf6' : '#94a3b8'; })
    .attr('d', 'M0,-5L10,0L0,5');

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(function(d){ return d.id; }).distance(90).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collide', d3.forceCollide().radius(function(d){ return 14 + d.degree * 2.2; }));

  const link = gRoot.append('g').attr('stroke-opacity', 0.7).selectAll('line')
    .data(links).join('line')
    .attr('stroke', function(d){ return d.tension ? '#8b5cf6' : '#94a3b8'; })
    .attr('stroke-width', function(d){ return d.tension ? 1.8 : 1.2; })
    .attr('stroke-dasharray', function(d){ return d.tension ? '5 4' : null; })
    .attr('marker-end', function(d){ return d.tension ? 'url(#arrow-tension)' : 'url(#arrow-link)'; });

  const linkText = gRoot.append('g').selectAll('text')
    .data(links).join('text')
    .attr('font-size', 9)
    .attr('fill', '#64748b')
    .attr('text-anchor', 'middle')
    .text(function(d){ return relLabel(d.type); });

  const node = gRoot.append('g').selectAll('g')
    .data(nodes).join('g')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', function(event, d){
        if(!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        svg.style('cursor', 'grabbing');
      })
      .on('drag', function(event, d){ d.fx = event.x; d.fy = event.y; })
      .on('end', function(event, d){
        if(!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
        svg.style('cursor', 'grab');
      }));

  node.append('circle')
    .attr('r', function(d){ return Math.min(28, 10 + d.degree * 2.8); })
    .attr('fill', function(d){ return d.color; })
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .attr('opacity', 0.95);

  node.append('title').text(function(d){
    return d.label + ' (' + d.type + ')';
  });

  node.append('text')
    .text(function(d){ return d.label.length > 20 ? d.label.slice(0,19)+'\u2026' : d.label; })
    .attr('x', 0)
    .attr('y', function(d){ return Math.min(28, 10 + d.degree * 2.8) + 12; })
    .attr('text-anchor', 'middle')
    .attr('font-size', 10)
    .attr('font-weight', 600)
    .attr('fill', '#0f172a');

  node.on('mouseover', function(event, d){
    const linked = {};
    links.forEach(function(l){
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const tg = typeof l.target === 'object' ? l.target.id : l.target;
      if(s === d.id || tg === d.id){ linked[s]=true; linked[tg]=true; }
    });
    node.attr('opacity', function(n){ return linked[n.id] || n.id===d.id ? 1 : 0.25; });
    link.attr('stroke-opacity', function(l){
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const tg = typeof l.target === 'object' ? l.target.id : l.target;
      return (s===d.id || tg===d.id) ? 1 : 0.15;
    });
  }).on('mouseout', function(){
    node.attr('opacity', 1);
    link.attr('stroke-opacity', 0.7);
  });

  simulation.on('tick', function(){
    link
      .attr('x1', function(d){ return d.source.x; })
      .attr('y1', function(d){ return d.source.y; })
      .attr('x2', function(d){ return d.target.x; })
      .attr('y2', function(d){ return d.target.y; });
    linkText
      .attr('x', function(d){ return (d.source.x + d.target.x)/2; })
      .attr('y', function(d){ return (d.source.y + d.target.y)/2 - 4; });
    node.attr('transform', function(d){ return 'translate('+d.x+','+d.y+')'; });
  });

  d3.select(container).append('p')
    .attr('class', 'text-[10px] text-slate-500 mt-1 px-1')
    .text(isEn
      ? 'D3 force graph - drag nodes, scroll to zoom, hover to focus links.'
      : 'Graphe D3 (force) - glissez les noeuds, molette pour zoomer, survol pour isoler les liens.');
}

function scheduleOntologyD3Mount(){
  const map = demoState.ontologyMap;
  if(!map) return;
  requestAnimationFrame(function(){
    const el = document.getElementById('ontology-d3-root');
    if(el) mountOntologyD3(map, el);
  });
}
