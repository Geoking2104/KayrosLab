/** Titres d’œuvres : source Gutenberg → titre français reçu. */
export const TITLES_FR: Record<string, string> = {
  "Pride and Prejudice": "Orgueil et Préjugés",
  "Sense and Sensibility": "Raison et Sensibilité",
  "The Critique of Pure Reason": "Critique de la raison pure",
  "The Critique of Practical Reason": "Critique de la raison pratique",
  "The World as Will and Idea (Vol. 1 of 3)": "Le Monde comme volonté et comme représentation",
  "Beyond Good and Evil": "Par-delà le bien et le mal",
  "Thus Spake Zarathustra: A Book for All and None": "Ainsi parlait Zarathoustra",
  "Phänomenologie des Geistes": "Phénoménologie de l’esprit",
  "The Republic": "La République",
  "The Nicomachean ethics of Aristotle": "Éthique à Nicomaque",
  "Discourse on the Method of Rightly Conducting One's Reason and of Seeking Truth in the Sciences": "Discours de la méthode",
  "Six metaphysical meditations": "Méditations métaphysiques",
  "The Social Contract": "Du contrat social",
  "Discourse on Inequality": "Discours sur l’origine et les fondements de l’inégalité parmi les hommes",
  "On Liberty": "De la liberté",
  "The Wealth of Nations": "La Richesse des nations",
  "The Prince": "Le Prince",
  "Crime and Punishment": "Crime et Châtiment",
  "War and Peace": "Guerre et Paix",
  "Don Quixote": "Don Quichotte",
  "The Trial": "Le Procès",
  "On the Origin of Species": "L’Origine des espèces",
  "The Communist Manifesto": "Manifeste du parti communiste",
  "The Art of War": "L’Art de la guerre",
  "The City of God, Volume I": "La Cité de Dieu",
  "Summa Theologica": "Somme théologique",
  "Leviathan": "Léviathan",
  "Ethics": "Éthique",
  "Theologico-Political Treatise": "Traité théologico-politique",
};

export function workTitleFr(title: string): string {
  const raw = String(title || "").trim();
  return TITLES_FR[raw] ?? raw;
}

export function rewriteTitlesInText(text: string): string {
  let out = String(text || "");
  const pairs = Object.entries(TITLES_FR)
    .filter(([src, fr]) => src !== fr)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [src, fr] of pairs) {
    if (out.includes(src)) out = out.split(src).join(fr);
  }
  return out;
}

export function looksForeignTitle(title: string): boolean {
  const raw = String(title || "").trim();
  return Boolean(raw && TITLES_FR[raw] && TITLES_FR[raw] !== raw);
}
