import { ENTITY_TYPES, RELATIONSHIPS } from '../data/ontology.js';

export default function OWLExporter({ competitorList, baseline }) {
  const handleExportOWL = () => {
    const owl = generateOWL(competitorList);
    download(owl, 'positionning-ontology.rdf', 'application/rdf+xml');
  };

  const handleExportJSON = () => {
    const data = {
      ontology: {
        name: 'Positionnement Concurrentiel',
        description: 'Ontologie d\'analyse concurrentielle multi-dimensionnelle sur 14 dimensions tech et business',
        entityTypes: ENTITY_TYPES,
        relationships: RELATIONSHIPS,
      },
      instances: (competitorList || []).map((c) => ({
        name: c.name,
        avgScore: c.avgScore,
        scores: c.scores,
      })),
      baseline: baseline || {},
      generatedAt: new Date().toISOString(),
    };
    download(JSON.stringify(data, null, 2), 'positionning-ontology.json', 'application/json');
  };

  if (!competitorList || competitorList.length === 0) return null;

  return (
    <div className="export-bar">
      <button className="btn btn-outline" onClick={handleExportJSON}>
        📥 JSON Ontology
      </button>
      <button className="btn btn-outline" onClick={handleExportOWL}>
        🏷️ Export OWL RDF/XML
      </button>
    </div>
  );
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateOWL(competitorList) {
  const ns = 'https://kayroslab.com/ontology/positionning#';
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
    '    <rdfs:comment>Ontologie d\'analyse concurrentielle multi-dimensionnelle sur 14 dimensions</rdfs:comment>',
    '  </owl:Ontology>',
    '',
  ];

  for (const et of ENTITY_TYPES) {
    lines.push(`  <owl:Class rdf:ID="${et.id}">`);
    lines.push(`    <rdfs:label>${esc(et.name)}</rdfs:label>`);
    lines.push(`    <rdfs:comment>${esc(et.description)}</rdfs:comment>`);
    lines.push('  </owl:Class>');
    lines.push('');

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
      lines.push('');
    }
  }

  for (const rel of RELATIONSHIPS) {
    lines.push(`  <owl:ObjectProperty rdf:ID="${rel.id}">`);
    lines.push(`    <rdfs:label>${esc(rel.name)}</rdfs:label>`);
    lines.push(`    <rdfs:domain rdf:resource="#${rel.from}"/>`);
    lines.push(`    <rdfs:range rdf:resource="#${rel.to}"/>`);
    lines.push(`    <rdfs:comment>${esc(rel.description)}</rdfs:comment>`);
    lines.push('  </owl:ObjectProperty>');
    lines.push('');
  }

  for (const comp of competitorList || []) {
    const compId = `comp-${comp.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    lines.push(`  <kl:Competitor rdf:ID="${compId}">`);
    lines.push(`    <kl:name>${esc(comp.name)}</kl:name>`);
    lines.push(`    <kl:avgScore>${comp.avgScore}</kl:avgScore>`);
    if (comp.url) lines.push(`    <kl:url rdf:resource="${esc(comp.url)}"/>`);
    lines.push('  </kl:Competitor>');
  }

  lines.push('', '</rdf:RDF>');
  return lines.join('\n');
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
