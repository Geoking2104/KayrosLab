export function setupBridge() {
  if (window.Kayros) {
    window.Kayros.positionning = {
      exportMatrix,
      exportRdf,
    };
  }
}

export function notifyKayrosLab(event, data) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ source: 'kayroslab-positionning', event, data }, '*');
  }
}

export function exportMatrix(idea, competitors, gaps) {
  return {
    type: 'positionning_matrix',
    generatedAt: new Date().toISOString(),
    idea,
    competitors: competitors.map((c) => ({
      name: c.name,
      avgScore: c.avgScore,
      neurons: c.neurons,
    })),
    gaps,
  };
}

export function exportRdf(idea, competitors) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let rdf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '         xmlns:kl="https://kayroslab.com/ontology/positionning#">',
    '',
    `  <kl:PositionningAnalysis rdf:about="https://kayroslab.com/positionning/${Date.now()}">`,
    `    <kl:idea>${esc(idea)}</kl:idea>`,
    `    <kl:generatedAt>${new Date().toISOString()}</kl:generatedAt>`,
  ];

  for (const comp of competitors) {
    const id = `comp-${comp.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    rdf.push(`    <kl:hasCompetitor rdf:resource="#${id}"/>`);
  }
  rdf.push('  </kl:PositionningAnalysis>');

  for (const comp of competitors) {
    const id = `comp-${comp.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    rdf.push(`  <kl:Competitor rdf:ID="${id}">`);
    rdf.push(`    <kl:name>${esc(comp.name)}</kl:name>`);
    rdf.push(`    <kl:avgScore>${comp.avgScore}</kl:avgScore>`);
    for (const [neuron, score] of Object.entries(comp.neurons)) {
      rdf.push(`    <kl:${neuron}>${score}</kl:${neuron}>`);
    }
    rdf.push('  </kl:Competitor>');
  }

  rdf.push('', '</rdf:RDF>');
  return rdf.join('\n');
}
