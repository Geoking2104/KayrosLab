function renderOntologyGraph(map){
  const width=640, height=360;
  const typeColor = {
    competitor:'#fb7185', capability:'#34d399', regulation:'#fbbf24',
    segment:'#38bdf8', tech:'#a78bfa', concept:'#94a3b8'
  };
  // Cluster entities by type around distinct angles (InfraNodus-like communities)
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
    const baseAngle = -Math.PI/2 + (Math.PI*2*ti/Math.max(types.length,1));
    const clusterR = 110;
    const cx = width/2 + Math.cos(baseAngle)*clusterR;
    const cy = height/2 + Math.sin(baseAngle)*clusterR * 0.85;
    group.forEach(function(ent, i){
      const localN = group.length;
      const a = baseAngle + (localN===1 ? 0 : (-0.35 + 0.7*(i/(localN-1||1))));
      const r = localN===1 ? 0 : 28 + (i%2)*12;
      positions[ent.id] = {
        x: cx + Math.cos(a)*r,
        y: cy + Math.sin(a)*r,
        color: typeColor[type]||typeColor.concept,
        type: type
      };
    });
  });
  const degree = {};
  map.entities.forEach(function(e){ degree[e.id]=1; });
  map.relations.forEach(function(r){
    degree[r.from]=(degree[r.from]||1)+1;
    degree[r.to]=(degree[r.to]||1)+1;
  });
  let svg = '';
  types.forEach(function(type, ti){
    const pts = byType[type].map(function(e){ return positions[e.id]; });
    if(!pts.length) return;
    const ax = pts.reduce(function(s,p){return s+p.x;},0)/pts.length;
    const ay = pts.reduce(function(s,p){return s+p.y;},0)/pts.length;
    svg += '<circle cx="'+ax.toFixed(1)+'" cy="'+ay.toFixed(1)+'" r="48" fill="'+(typeColor[type]||'#94a3b8')+'" opacity="0.08"></circle>';
    svg += '<text x="'+ax.toFixed(1)+'" y="'+(ay-52).toFixed(1)+'" text-anchor="middle" font-size="9" font-weight="600" fill="'+(typeColor[type]||'#64748b')+'" opacity="0.85">'+escapeHtml(type)+'</text>';
  });
  map.relations.forEach(function(rel){
    const a=positions[rel.from], b=positions[rel.to];
    if(!a||!b) return;
    const isGapish = /diverges|competes|constrains/.test(rel.type||'');
    const cls = isGapish ? 'bridge-edge' : 'edge';
    svg += '<line class="'+cls+'" x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'"></line>';
    const mx=((a.x+b.x)/2).toFixed(1), my=((a.y+b.y)/2).toFixed(1);
    const relLab = String(rel.type||'').replace(/_/g,' ');
    if(relLab){
      svg += '<rect x="'+(mx-26)+'" y="'+(my-8)+'" width="52" height="14" rx="3" fill="#fff" opacity="0.85"></rect>';
      svg += '<text x="'+mx+'" y="'+(Number(my)+3)+'" text-anchor="middle" font-size="8" fill="#64748b">'+escapeHtml(relLab.slice(0,14))+'</text>';
    }
  });
  map.entities.forEach(function(ent){
    const p=positions[ent.id];
    if(!p) return;
    const r = Math.min(26, 12 + (degree[ent.id]||1)*2.5);
    svg += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+r+'" fill="'+p.color+'" stroke="#fff" stroke-width="2" opacity="0.95"></circle>';
    const label = ent.label.length>18 ? ent.label.slice(0,17)+'\u2026' : ent.label;
    const lw = Math.min(120, 6+label.length*5.2);
    svg += '<rect x="'+(p.x-lw/2).toFixed(1)+'" y="'+(p.y+r+2).toFixed(1)+'" width="'+lw.toFixed(1)+'" height="14" rx="3" fill="#ffffff" opacity="0.92"></rect>';
    svg += '<text x="'+p.x.toFixed(1)+'" y="'+(p.y+r+12).toFixed(1)+'" text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a">'+escapeHtml(label)+'</text>';
  });
  return svg;
}
