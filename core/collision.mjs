// KayrosLab — Etape 3 "Construire" Collision Mode (EF-06 / F3/F7).
// Bisociation gouvernee : forcer la collision de 2 concepts DISTANTS → idee
// originale. La nouveaute est derivee de la distance reelle des concepts
// (tags/partage), jamais inventee ; la faisabilite et la proposition sont
// fournies par le LLM/humain (Synthesizer/Bisociateur) — sans elles, le score
// nouveaute x faisabilite reste null. Chaque collision ajoutee est horodatee
// et tracee (timeline append-only, F7).

export const DEFAULT_PLANCHER_DISTANCE = 60;

const clamp = (x) => Math.max(0, Math.min(100, Number(x) || 0));

/** Id stable d'une collision (dedupe par paire de concepts ordonnés). */
export function idCollision(a, b) {
  const [x, y] = [String(a ?? ''), String(b ?? '')].sort();
  return `coll-${x}--${y}`;
}

/**
 * Distance reelle entre deux concepts (0..100) : partage de tags → proximite,
 * aucun tag commun → distance forte. Deterministe depuis les donnees reelles.
 */
export function distanceConcepts(a = {}, b = {}) {
  const ta = new Set(a.tags ?? []);
  const tb = new Set(b.tags ?? []);
  if (!ta.size && !tb.size) return 100; // inconnus → par defaut distants, aucun partage mesure
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (!union) return 100;
  const jaccard = inter / union;
  return Math.round(100 * (1 - jaccard));
}

/** Vrai si une paire est deja collisionnee (evite les doublons). */
export function dejaCollisionne(historique, a, b) {
  return historique.some((c) => c.concepts.includes(String(a ?? '')) && c.concepts.includes(String(b ?? '')));
}

/**
 * Normalise une collision : `{ id, concepts:[a,b], proposition?, faisabilite?,
 * framework? (importe du Bisociateur), proposant? }`. La proposition et la
 * faisabilite restent fournies par le LLM/humain ; le moteur ne les devine pas.
 */
export function normalizeCollision(c = {}, { index = 0 } = {}) {
  const concepts = (c.concepts ?? [c.a, c.b]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (concepts.length < 2) throw new Error('collision: deux concepts requis');
  const [a, b] = concepts.slice(0, 2);
  const faisabilite = c.faisabilite != null ? clamp(c.faisabilite) : null;
  return {
    id: c.id ?? idCollision(a, b),
    concepts: [a, b],
    proposition: c.proposition ?? null,
    faisabilite,
    framework: c.framework ?? null,
    proposant: c.proposant ?? null,
    index,
  };
}

/** Score d'une collision : nouveaute x faisabilite / 100 (null sans faisabilite). */
export function scoreCollision(collision, { distance } = {}) {
  const nouveaute = distance != null ? clamp(distance) : (collision.nouveaute ?? null);
  return {
    ...collision,
    nouveaute,
    score: (collision.faisabilite != null && nouveaute != null)
      ? Math.round((nouveaute * collision.faisabilite) / 100)
      : null,
  };
}

/**
 * Collision Mode (EF-06) : genere les paires de concepts DISTANTS non deja
 * collisionnees. Nouveaute = distance reelle ; proposition/faisabilite fournies
 * via `generer` (LLM/humain) ou par des collisions en entree.
 */
export function runCollisionMode(concepts = [], {
  reseau = null,
  historique = [],
  plancher = DEFAULT_PLANCHER_DISTANCE,
  generer = null,
  proposant = null,
  ts = null,
} = {}) {
  const items = concepts.map((c, i) => {
    const nom = String(c.nom ?? c.name ?? c.id ?? c ?? '').trim();
    return { id: String(c.id ?? nom), nom, tags: [...new Set((c.tags ?? []).map(String))] };
  });
  const collisions = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (reseau && reseau.aretes?.some((e) => (e.de === a.id && e.vers === b.id) || (e.de === b.id && e.vers === a.id))) continue;
      if (dejaCollisionne(historique, a.id, b.id)) continue;
      const distance = distanceConcepts(a, b);
      if (distance < plancher) continue;
      let collision = normalizeCollision({ concepts: [a.id, b.id], proposant }, { index: collisions.length });
      if (typeof generer === 'function') {
        try {
          const apport = generer({ de: a, vers: b, distance }) ?? {};
          collision = normalizeCollision({ ...collision, ...apport, concepts: [a.id, b.id] }, { index: collisions.length });
        } catch { /* apport invalide → collision brute, jamais devinee */ }
      }
      collisions.push(scoreCollision(collision, { distance }));
    }
  }
  return {
    collisions: collisions.sort((x, y) => (y.score ?? y.nouveaute) - (x.score ?? x.nouveaute)),
    totalCollisions: collisions.length,
    totalDistantes: items.length,
    ts: ts ?? new Date().toISOString(),
  };
}

/** Ajout d'une collision a la timeline (append-only horodate, dedupe par id). */
export function addCollision(timeline, collision, { by = null, ideaId = null, ts = null } = {}) {
  const t = timeline ?? [];
  const c = normalizeCollision(collision, { index: t.length });
  if (t.some((x) => x.id === c.id)) throw new Error('collision: deja presente dans la timeline');
  return {
    timeline: [...t, {
      ...c,
      ajout: { by, ideaId, ts: ts ?? new Date().toISOString() },
    }],
    collision: c,
  };
}

/** Synthese Collision Mode (EF-06/F7) : comptages reels, jamais de chiffres inventes. */
export function rapportCollision(timeline = [], { collisions = [] } = {}) {
  const toutes = [...(collisions ?? []), ...(timeline ?? [])];
  const scores = toutes.map((c) => c.score).filter((s) => s != null);
  const distances = toutes.map((c) => c.nouveaute).filter((n) => n != null);
  return {
    timeline,
    totalIdees: toutes.length,
    scorees: scores.length,
    nonScorees: toutes.length - scores.length,
    meilleurScore: scores.length ? Math.max(...scores) : null,
    scoreMoyen: scores.length ? Math.round(scores.reduce((n, s) => n + s, 0) / scores.length) : null,
    distanceMoyenne: distances.length ? Math.round(distances.reduce((n, d) => n + d, 0) / distances.length) : null,
    rendu: `Collision Mode : ${toutes.length} idée(s) bisociative(s) (${scores.length} scorée(s), ${toutes.length - scores.length} à scorer). Fournir la faisabilité pour scorer (nouveauté × faisabilité).`,
  };
}
