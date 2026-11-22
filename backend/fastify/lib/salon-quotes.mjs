/** Vérification des citations du Salon : une citation n'est admise que si elle
 * provient d'une œuvre de l'auteur, à la ponctuation près.
 *
 * Extrait de routes/salon-speak.mjs pour être testable seul. Le point délicat
 * est la typographie française : « enrageant ; car » (source Gutenberg) et
 * « enrageant; car » (réplique du modèle) désignent la même phrase ; sans
 * normalisation, la citation était rejetée et la réplique tombait en repli.
 */

export function canonical(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    // Apostrophes et guillemets typographiques → ASCII.
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011]/g, '-')
    .replace(/\u2026/g, '...')
    // Espace avant la ponctuation : « mot ; » et « mot; » sont équivalents.
    .replace(/\s+([;:!?.,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Correspondance exacte, préfixe, ou citation elliptique « ... » par fragments. */
export function quoteMatches(q, source) {
  const cq = canonical(q).replace(/\s*\.\.\.\s*$/, '');
  const cs = canonical(source);
  if (cs.includes(cq)) return true;
  const parts = cq.split(/\s*\.\.\.\s*/).filter((p) => p.length >= 12);
  if (parts.length > 1) {
    let pos = 0;
    for (const part of parts) {
      const at = cs.indexOf(part, pos);
      if (at < 0) return false;
      pos = at + part.length;
    }
    return true;
  }
  return cq.length >= 20 && cs.startsWith(cq);
}

/**
 * Extrait les citations entre guillemets et vérifie chacune contre les passages
 * de l'auteur. Une œuvre d'un autre auteur citée dans le corps est refusée.
 * @returns {{ citations: Array<{text: string, source: any}>, errors: string[], unmatched: string[] }}
 */
export function verifyQuotes(text, author, sources, otherTitles = []) {
  const known = (author.works || []).map((w) => canonical(w.title)).filter(Boolean);
  const citations = [];
  const errors = [];
  const unmatched = [];
  for (const m of String(text || '').matchAll(/[«"“]([^«»"“”]{20,400})[»"”]/g)) {
    const q = m[1].trim();
    const cq = canonical(q);
    if (known.some((t) => t === cq || t.includes(cq) || cq.includes(t.split(':')[0]))) continue;
    const hit = sources.find((s) => quoteMatches(q, s));
    if (hit) citations.push({ text: q, source: hit });
    else { errors.push(`citation non vérifiée : « ${q.slice(0, 60)}… »`); unmatched.push(q); }
  }
  // Une œuvre d'un autre auteur glissée dans la bouche du convive est une
  // hallucination d'attribution : on la refuse, même hors guillemets.
  const body = canonical(text);
  for (const t of otherTitles) {
    if (t.length >= 8 && body.includes(t)) errors.push(`œuvre d'un autre auteur : « ${t} »`);
  }
  return { citations, errors, unmatched };
}
