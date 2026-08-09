function mountOntologySigma(map, container){
  if(!container || !map || !map.entities) return;
  if(typeof graphology === 'undefined' || typeof Sigma === 'undefined'){
    if(window.d3 && typeof mountOntologyD3 === 'function'){
      mountOntologyD3(map, container);
      return;
    }
    if(typeof renderOntologyGraph === 'function'){
      container.innerHTML = '<svg class="semantic-graph w-full" viewBox="0 0 640 360">'+renderOntologyGraph(map)+'</svg>';
    }
    return;
  }

  const typeColor = {
    competitor:'#fb7185', capability:'#34d399', regulation:'#fbbf24',
    segment:'#38bdf8', tech:'#a78bfa', concept:'#94a3b8'
  };
  const isEn = (typeof cycleLanguage === 'function' ? cycleLanguage() : 'fr') === 'en';
  const relLabel = function(t){
    const fr = {competes_with:'rivalise', enables:'permet', constrains:'contraint', serves:'sert', diverges_from:'diverge', drives:'pousse', related:'relie'};
    const en = {competes_with:'competes', enables:'enables', constrains:'constrains', serves:'serves', diverges_from:'diverges', drives:'drives', related:'related'};
    const m = isEn ? en : fr;
    return m[t] || String(t||'').replace(/_/g,' ');
  };

  if(container._sigma){
    try { container._sigma.kill(); } catch(e) {}
    container._sigma = null;
  }
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.height = '420px';
  container.style.minHeight = '420px';
  container.style.borderRadius = '0.75rem';
  container.style.border = '1px solid #e2e8f0';
  container.style.background = 'linear-gradient(180deg,#f8fafc 0%,#fff 100%)';
  container.style.overflow = 'hidden';

  const Graph = graphology.Graph || graphology;
  const graph = new Graph();

  const degree = {};
  map.entities.forEach(function(e){ degree[e.id] = 1; });
  (map.relations||[]).forEach(function(r){
    degree[r.from] = (degree[r.from]||1)+1;
    degree[r.to] = (degree[r.to]||1)+1;
  });

  const byType = {};
  map.entities.forEach(function(e){
    const k = e.type||'concept';
    if(!byType[k]) byType[k]=[];
    byType[k].push(e);
  });
  const types = Object.keys(byType);
  const positions = {};
  types.forEach(function(type, ti){
    const group = byType[type];
    const base = -Math.PI/2 + (Math.PI*2*ti/Math.max(types.length,1));
    group.forEach(function(ent, i){
      const a = base + (group.length===1 ? 0 : (-0.4 + 0.8*(i/(group.length-1||1))));
      const r = 0.35 + (i%3)*0.08;
      positions[ent.id] = { x: Math.cos(a)*r, y: Math.sin(a)*r };
    });
  });

  map.entities.forEach(function(e){
    const p = positions[e.id] || { x: Math.random()-0.5, y: Math.random()-0.5 };
    graph.addNode(e.id, {
      label: e.label,
      type: e.type||'concept',
      size: Math.min(18, 6 + (degree[e.id]||1)*2),
      color: typeColor[e.type]||typeColor.concept,
      x: p.x,
      y: p.y
    });
  });

  (map.relations||[]).forEach(function(r, i){
    if(!graph.hasNode(r.from) || !graph.hasNode(r.to)) return;
    const key = r.from + '->' + r.to + '-' + i;
    if(graph.hasEdge(key)) return;
    try {
      const tension = /diverges|competes|constrains/.test(r.type||'');
      graph.addEdgeWithKey(key, r.from, r.to, {
        label: relLabel(r.type),
        size: tension ? 2 : 1,
        color: tension ? '#8b5cf6' : '#94a3b8',
        type: 'line'
      });
    } catch(err) {}
  });

  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: true,
    enableEdgeEvents: true,
    defaultEdgeColor: '#94a3b8',
    defaultNodeColor: '#94a3b8',
    labelFont: 'system-ui,sans-serif',
    labelSize: 12,
    labelWeight: '600',
    labelColor: { color: '#0f172a' },
    stagePadding: 30,
    minCameraRatio: 0.2,
    maxCameraRatio: 3
  });
  container._sigma = renderer;

  let hovered = null;
  renderer.on('enterNode', function(e){
    hovered = e.node;
    renderer.refresh();
  });
  renderer.on('leaveNode', function(){
    hovered = null;
    renderer.refresh();
  });
  renderer.setSetting('nodeReducer', function(node, data){
    if(!hovered) return data;
    const neighbors = graph.neighbors(hovered);
    if(node === hovered || neighbors.indexOf(node) >= 0) return data;
    return Object.assign({}, data, { color: '#e2e8f0', label: '' });
  });
  renderer.setSetting('edgeReducer', function(edge, data){
    if(!hovered) return data;
    const extremities = graph.extremities(edge);
    if(extremities[0] === hovered || extremities[1] === hovered) {
      return Object.assign({}, data, { color: '#7c3aed', size: (data.size||1)+1 });
    }
    return Object.assign({}, data, { color: '#f1f5f9' });
  });

  const hint = document.createElement('p');
  hint.className = 'text-[10px] text-slate-500 mt-1 px-1';
  hint.textContent = isEn
    ? 'Sigma.js network - scroll to zoom, drag to pan, hover a node to focus its neighborhood.'
    : 'Reseau Sigma.js - molette pour zoomer, glisser pour naviguer, survol pour isoler le voisinage.';
  if(container.parentNode) container.parentNode.appendChild(hint);
}

function scheduleOntologySigmaMount(){
  const map = demoState && demoState.ontologyMap;
  if(!map) return;
  requestAnimationFrame(function(){
    const el = document.getElementById('ontology-d3-root') || document.getElementById('ontology-sigma-root');
    if(el) mountOntologySigma(map, el);
  });
}
function scheduleOntologyD3Mount(){ scheduleOntologySigmaMount(); }
