import { ENTITY_TYPES, RELATIONSHIPS } from './ontology.mjs';

export function generateOWL(competitorList = []) {
  const ns = 'https://kayroslab.com/ontology/positionning#';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF',
    '  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
    '  xmlns:owl="http://www.w3.org/2002/07/owl#"',
    '  xmlns:xsd="http://www.w3.org/2001/XMLSchema#"',
    `  xmlns:kl="${ns}">`,
    '',
    `  <owl:Ontology rdf:about="${ns}">`,
    '    <rdfs:label>Positionnement Concurrentiel</rdfs:label>',
    '    <rdfs:comment>Multi-dimensional competitive analysis ontology across 14 tech and business dimensions</rdfs:comment>',
    '  </owl:Ontology>',
    '',
  ];

  for (const et of ENTITY_TYPES) {
    lines.push(`  <owl:Class rdf:ID="${et.id}">`);
    lines.push(`    <rdfs:label>${esc(et.name)}</rdfs:label>`);
    lines.push(`    <rdfs:comment>${esc(et.description)}</rdfs:comment>`);
    lines.push('  </owl:Class>');

    for (const prop of et.properties) {
      const propId = `${et.id}_${prop.name}`;
      const isObjProp = prop.type === 'enum';
      if (isObjProp) {
        lines.push(`  <owl:ObjectProperty rdf:ID="${propId}">`);
      } else {
        lines.push(`  <owl:DatatypeProperty rdf:ID="${propId}">`);
      }
      lines.push(`    <rdfs:label>${esc(prop.name)}</rdfs:label>`);
      lines.push(`    <rdfs:domain rdf:resource="#${et.id}"/>`);
      if (prop.type === 'integer') lines.push('    <rdfs:range rdf:resource="http://www.w3.org/2001/XMLSchema#integer"/>');
      else if (prop.type === 'decimal') lines.push('    <rdfs:range rdf:resource="http://www.w3.org/2001/XMLSchema#decimal"/>');
      else if (prop.type === 'boolean') lines.push('    <rdfs:range rdf:resource="http://www.w3.org/2001/XMLSchema#boolean"/>');
      else lines.push('    <rdfs:range rdf:resource="http://www.w3.org/2001/XMLSchema#string"/>');
      lines.push('  </owl:' + (isObjProp ? 'ObjectProperty' : 'DatatypeProperty') + '>');
    }
  }

  for (const rel of RELATIONSHIPS) {
    lines.push(`  <owl:ObjectProperty rdf:ID="${rel.id}">`);
    lines.push(`    <rdfs:label>${esc(rel.name)}</rdfs:label>`);
    lines.push(`    <rdfs:domain rdf:resource="#${rel.from}"/>`);
    lines.push(`    <rdfs:range rdf:resource="#${rel.to}"/>`);
    lines.push(`    <rdfs:comment>${esc(rel.description)}</rdfs:comment>`);
    lines.push('  </owl:ObjectProperty>');
  }

  for (const comp of competitorList) {
    const compId = `comp-${String(comp.name).replace(/[^a-zA-Z0-9]/g, '')}`;
    lines.push(`  <kl:Competitor rdf:ID="${compId}">`);
    lines.push(`    <kl:name>${esc(comp.name)}</kl:name>`);
    lines.push(`    <kl:avgScore>${comp.avgScore}</kl:avgScore>`);
    if (comp.url) lines.push(`    <kl:url rdf:resource="${esc(comp.url)}"/>`);
    if (comp.source) lines.push(`    <kl:source>${esc(comp.source)}</kl:source>`);
    lines.push('  </kl:Competitor>');
  }

  lines.push('', '</rdf:RDF>');
  return lines.join('\n');
}

export function generateJSON(competitorList = [], baseline = {}) {
  return JSON.stringify({
    ontology: {
      name: 'Positionnement Concurrentiel',
      description: 'Multi-dimensional competitive analysis ontology across 14 tech and business dimensions',
      entityTypes: ENTITY_TYPES.map((e) => ({ id: e.id, name: e.name, group: e.group, properties: e.properties })),
      relationships: RELATIONSHIPS.map((r) => ({ id: r.id, name: r.name, from: r.from, to: r.to, cardinality: r.cardinality })),
    },
    instances: (competitorList || []).map((c) => ({
      name: c.name, url: c.url, avgScore: c.avgScore, scores: c.scores, source: c.source,
    })),
    baseline: baseline || {},
    generatedAt: new Date().toISOString(),
  }, null, 2);
}
