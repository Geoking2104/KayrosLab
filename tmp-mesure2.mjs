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
  const res = await fetch(`${API}/v1/salon/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId, question, locale: 'fr', act: 'reponse' }),
    signal: AbortSignal.timeout(175000),
  });
  const j = await res.json();
  rows.push({
    authorId,
    engine: j.engine,
    cites: (j.citations || []).length,
    words: (String(j.text || '').match(/[\p{L}\p{N}'-]+/gu) || []).length,
    degraded: typeof j.degraded === 'string' ? j.degraded : (j.degraded ? 'objet' : ''),
    fallback: j.providerFallback ? `${j.providerFallback.from}->${j.providerFallback.to}` : '',
    prise: String(j.prise || '').slice(0, 50),
  });
}

console.log(`tours LLM : ${rows.filter((r) => r.engine === 'llm').length}/${rows.length}`);
for (const r of rows) {
  console.log(`${r.authorId.padEnd(10)} ${String(r.engine).padEnd(9)} cites=${r.cites} mots=${String(r.words).padStart(3)} ${String(r.degraded).padEnd(22)} ${r.fallback.padEnd(15)} « ${r.prise} »`);
}
