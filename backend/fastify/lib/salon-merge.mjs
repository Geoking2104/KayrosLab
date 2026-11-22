/** Fusion de deux versions d'un même cercle du Salon.
 *
 * Deux onglets (ou deux appareils) peuvent écrire entre deux relectures. Sans
 * fusion, la dernière écriture efface les tours que l'autre venait d'ajouter.
 * Ici : union des convives et des tours, dédoublonnage par (auteur, texte),
 * ordre chronologique rétabli, question entrante prioritaire si non vide.
 */

export function turnKey(turn) {
  return `${turn?.authorId || ''}|${String(turn?.text || '').trim().slice(0, 160)}`;
}

export function mergeRooms(stored, incoming) {
  const old = stored && typeof stored === 'object' ? stored : {};
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  const authorIds = [...new Set([...(old.authorIds || []), ...(next.authorIds || [])])].slice(0, 40);
  const byKey = new Map();
  for (const turn of [...(old.turns || []), ...(next.turns || [])]) {
    // Un tour sans texte n'est pas un tour : il ne doit pas créer d'entrée.
    if (!String(turn?.text || '').trim()) continue;
    const key = turnKey(turn);
    const seen = byKey.get(key);
    // La version entrante gagne sur le contenu, jamais sur l'existence du tour.
    byKey.set(key, seen ? { ...seen, ...turn } : turn);
  }
  const turns = [...byKey.values()].sort((a, b) => {
    const ta = Date.parse(a?.createdAt || 0);
    const tb = Date.parse(b?.createdAt || 0);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return 0;
  });
  const question = String(next.question || '').trim() ? next.question : (old.question || '');
  return { ...old, ...next, id: 'table', authorIds, turns, question };
}
