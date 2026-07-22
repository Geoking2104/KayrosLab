import { exportMatrix, exportRdf } from '../integration/kayroslabBridge.js';

export default function ExportButtons({ idea, competitors, gaps }) {
  if (!competitors || competitors.length === 0) return null;

  const handleExportJson = () => {
    const data = exportMatrix(idea, competitors, gaps);
    download(JSON.stringify(data, null, 2), 'positionning-matrix.json', 'application/json');
  };

  const handleExportRdf = () => {
    const rdf = exportRdf(idea, competitors);
    download(rdf, 'positionning-ontology.rdf', 'application/rdf+xml');
  };

  return (
    <div className="export-bar">
      <button className="btn btn-sm btn-outline" onClick={handleExportJson}>
        📥 Exporter matrice JSON
      </button>
      <button className="btn btn-sm btn-outline" onClick={handleExportRdf}>
        🏷️ Exporter RDF
      </button>
    </div>
  );
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
