const API = 'https://api.kayroslab.com';
const cases = [
  ['voltaire', 'Le rire est-il philosophique ?'],
  ['rousseau', 'La liberté suppose-t-elle l’inégalité ?'],
  ['montaigne', 'Que sait-on vraiment de soi-même ?'],
  ['platon', 'Peut-on connaître sans avoir été trompé ?'],
  ['machiavel', 'La ruse vaut-elle mieux que la force ?'],
  ['nietzsche', 'La morale est-elle une invention des faibles ?'],
  ['kant', 'Agir par devoir suffit-il à être bon ?'],
  ['austen', 'Le mariage est-il une affaire de sentiment ?'],
];

const rows = [];
for (const [authorId, question] of cases) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/v1/salon/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorId, question, locale: 'fr', act: 'reponse' }),
      signal: AbortSignal.timeout(175000),
    });
    const j = await res.json();
    rows.push({
      authorId,
      status: res.status,
      ms: Date.now() - t0,
      engine: j.engine,
      provider: j.provider,
      deg: String(j.degraded || '').slice(0, 60),
      cites: Array.isArray(j.citations) ? j.citations.length : 0,
      words: (String(j.text || '').match(/[\p{L}\p{N}'-]+/gu) || []).length,
    });
  } catch (e) {
    rows.push({ authorId, error: e.message });
  }
}

const llm = rows.filter((r) => r.engine === 'llm').length;
console.log(`tours LLM (auteur) : ${llm}/${rows.length}`);
for (const r of rows) {
  console.log(`${r.authorId.padEnd(10)} ${String(r.status).padEnd(4)} ${String(r.ms).padStart(6)}ms ${String(r.engine).padEnd(9)} ${String(r.provider).padEnd(8)} cites=${r.cites} mots=${r.words} ${r.degraded || ''}`);
}
const reasons = {};
for (const r of rows.filter((x) => x.engine !== 'llm')) {
  const key = (r.deg || 'inconnu').replace(/\s*:.*$/, '').slice(0, 40);
  reasons[key] = (reasons[key] || 0) + 1;
}
console.log('motifs de repli :', JSON.stringify(reasons));
