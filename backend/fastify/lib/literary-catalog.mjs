// Catalogue d'auteurs du domaine public pour les personnalités d'agents.
// Chaque URL a été vérifiée par son titre réel dans l'en-tête Project Gutenberg
// (contrôle du 2026-09-09) — aucune URL non confirmée n'est admise ici.

export const LITERARY_KINDS = ['philosophe', 'écrivain', 'dramaturge', 'poète', 'essayiste', 'savant', 'économiste'];

export const LITERARY_AUTHORS = Object.freeze([
  {
    id: 'hugo', name: 'Victor Hugo', kind: 'écrivain', lang: 'fr',
    era: '1802–1885 · romantisme',
    blurb: 'La fresque sociale et la voix des humbles : misère, justice, révolte et espérance.',
    wikipedia: 'Victor Hugo',
    works: [
      { title: 'Les Misérables (tome I : Fantine)', url: 'https://www.gutenberg.org/cache/epub/17489/pg17489.txt' },
      { title: 'Notre-Dame de Paris', url: 'https://www.gutenberg.org/cache/epub/19657/pg19657.txt' },
    ],
  },
  {
    id: 'balzac', name: 'Honoré de Balzac', kind: 'écrivain', lang: 'fr',
    era: '1799–1850 · réalisme',
    blurb: 'L\'observateur impitoyable des appétits, de l\'argent et des ambitions de la société.',
    wikipedia: 'Honoré de Balzac',
    works: [
      { title: 'La Comédie humaine (volume I)', url: 'https://www.gutenberg.org/cache/epub/41211/pg41211.txt' },
    ],
  },
  {
    id: 'stendhal', name: 'Stendhal', kind: 'écrivain', lang: 'fr',
    era: '1783–1842 · réalisme',
    blurb: 'Le calcul du cœur et de l\'ambition : l\'ascension sociale vue de l\'intérieur.',
    wikipedia: 'Stendhal',
    works: [
      { title: 'Le Rouge et le Noir', url: 'https://www.gutenberg.org/cache/epub/798/pg798.txt' },
    ],
  },
  {
    id: 'verne', name: 'Jules Verne', kind: 'écrivain', lang: 'fr',
    era: '1828–1905 · aventure scientifique',
    blurb: 'La technique au service de l\'exploration : ingénierie, risques et terres inconnues.',
    wikipedia: 'Jules Verne',
    works: [
      { title: 'Vingt mille lieues sous les mers', url: 'https://www.gutenberg.org/cache/epub/5097/pg5097.txt' },
    ],
  },
  {
    id: 'voltaire', name: 'Voltaire', kind: 'philosophe', lang: 'fr',
    era: '1694–1778 · Lumières',
    blurb: 'L\'ironie contre les dogmes : optimisme naïf mis à l\'épreuve du réel, tolérance, lucidité.',
    wikipedia: 'Voltaire',
    works: [
      { title: 'Candide, ou l\'optimisme', url: 'https://www.gutenberg.org/cache/epub/4650/pg4650.txt' },
    ],
  },
  {
    id: 'descartes', name: 'René Descartes', kind: 'philosophe', lang: 'fr',
    era: '1596–1650 · rationalisme',
    blurb: 'Le doute méthodique : diviser le problème, examiner les preuves, ne conclure que sur le clair.',
    wikipedia: 'René Descartes',
    works: [
      { title: 'Discours de la méthode', url: 'https://www.gutenberg.org/cache/epub/13846/pg13846.txt' },
    ],
  },
  {
    id: 'rousseau', name: 'Jean-Jacques Rousseau', kind: 'philosophe', lang: 'fr',
    era: '1712–1778 · Lumières',
    blurb: 'L\'éducation par l\'expérience, le contrat social et le prix de la civilisation.',
    wikipedia: 'Jean-Jacques Rousseau',
    works: [
      { title: 'Émile ou De l\'éducation', url: 'https://www.gutenberg.org/cache/epub/5427/pg5427.txt' },
    ],
  },
  {
    id: 'montaigne', name: 'Michel de Montaigne', kind: 'essayiste', lang: 'en',
    era: '1533–1592 · humanisme (trad. anglaise)',
    blurb: 'L\'essai comme méthode : juger par soi-même, douter, comparer — « que sais-je ? ».',
    wikipedia: 'Michel de Montaigne',
    works: [
      { title: 'Essays of Michel de Montaigne — Complete (trad. anglaise)', url: 'https://www.gutenberg.org/cache/epub/3600/pg3600.txt' },
    ],
  },
  {
    id: 'shakespeare', name: 'William Shakespeare', kind: 'dramaturge', lang: 'en',
    era: '1564–1616 · Renaissance',
    blurb: 'Ambition, trahison et destins qui basculent : toute décision a son monologue et sa chute.',
    wikipedia: 'William Shakespeare',
    works: [
      { title: 'The Complete Works of William Shakespeare', url: 'https://www.gutenberg.org/cache/epub/100/pg100.txt' },
    ],
  },
  {
    id: 'austen', name: 'Jane Austen', kind: 'écrivain', lang: 'en',
    era: '1775–1817 · roman de mœurs',
    blurb: 'Les intérêts dissimulés sous les convenances : lire les gens, leurs calculs et leurs orgueils.',
    wikipedia: 'Jane Austen',
    works: [
      { title: 'Pride and Prejudice', url: 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt' },
    ],
  },
  {
    id: 'poe', name: 'Edgar Allan Poe', kind: 'écrivain', lang: 'en',
    era: '1809–1849 · fantastique',
    blurb: 'La logique poussée jusqu\'à l\'obsession : ce qui peut mal tourner finit par mal tourner.',
    wikipedia: 'Edgar Allan Poe',
    works: [
      { title: 'The Works of Edgar Allan Poe, Volume 1', url: 'https://www.gutenberg.org/cache/epub/2147/pg2147.txt' },
    ],
  },
  {
    id: 'platon', name: 'Platon', kind: 'philosophe', lang: 'en',
    era: '–348 av. J.-C. · antique',
    blurb: 'Le dialogue comme méthode : définitions mises à l\'épreuve, allégories, justice examinée.',
    wikipedia: 'Platon',
    works: [
      { title: 'The Republic', url: 'https://www.gutenberg.org/cache/epub/1497/pg1497.txt' },
      { title: 'Apology', url: 'https://www.gutenberg.org/cache/epub/1656/pg1656.txt' },
    ],
  },
  {
    id: 'aristote', name: 'Aristote', kind: 'philosophe', lang: 'en',
    era: '–322 av. J.-C. · antique',
    blurb: 'La vertu comme milieu, la prudence pratique et la classification rigoureuse des causes.',
    wikipedia: 'Aristote',
    works: [
      { title: 'Politics', url: 'https://www.gutenberg.org/cache/epub/6762/pg6762.txt' },
      { title: 'The Nicomachean Ethics', url: 'https://www.gutenberg.org/cache/epub/8438/pg8438.txt' },
    ],
  },
  {
    id: 'marcaurele', name: 'Marc Aurèle', kind: 'philosophe', lang: 'en',
    era: '121–180 · stoïcisme',
    blurb: 'Le stoïcisme du dirigeant : distinguer ce qui dépend de toi, agir sans bruit, accepter la perte.',
    wikipedia: 'Marc Aurèle',
    works: [
      { title: 'Meditations', url: 'https://www.gutenberg.org/cache/epub/2680/pg2680.txt' },
    ],
  },
  {
    id: 'confucius', name: 'Confucius', kind: 'philosophe', lang: 'en',
    era: '–479 av. J.-C. · antique',
    blurb: 'Le rapport de confiance, l\'exemplarité du responsable et la constance avant la performance.',
    wikipedia: 'Confucius',
    works: [
      { title: 'The Analects of Confucius', url: 'https://www.gutenberg.org/cache/epub/3330/pg3330.txt' },
    ],
  },
  {
    id: 'suntzu', name: 'Sun Tzu', kind: 'philosophe', lang: 'en',
    era: 'VIe s. av. J.-C. · stratégies',
    blurb: 'Gagner sans combattre : position, timing, information — le conflit comme dernier recours.',
    wikipedia: 'Sun Tzu',
    works: [
      { title: 'The Art of War', url: 'https://www.gutenberg.org/cache/epub/132/pg132.txt' },
    ],
  },
  {
    id: 'machiavel', name: 'Nicolas Machiavel', kind: 'philosophe', lang: 'en',
    era: '1469–1527 · Renaissance',
    blurb: 'Le pouvoir tel qu\'il est : fortuna, occasion, crédibilité — ni cynisme de façade ni idéalisme.',
    wikipedia: 'Nicolas Machiavel',
    works: [
      { title: 'The Prince', url: 'https://www.gutenberg.org/cache/epub/1232/pg1232.txt' },
    ],
  },
  {
    id: 'kant', name: 'Emmanuel Kant', kind: 'philosophe', lang: 'en',
    era: '1724–1804 · idéalisme',
    blurb: 'L\'impératif catégorique : ne traiter personne comme un simple moyen, universaliser la règle.',
    wikipedia: 'Emmanuel Kant',
    works: [
      { title: 'The Critique of Pure Reason', url: 'https://www.gutenberg.org/cache/epub/4280/pg4280.txt' },
    ],
  },
  {
    id: 'nietzsche', name: 'Friedrich Nietzsche', kind: 'philosophe', lang: 'en',
    era: '1844–1900 · modernité',
    blurb: 'Soupçonner les valeurs installées : volonté, courage de penser contre, création de sens.',
    wikipedia: 'Friedrich Nietzsche',
    works: [
      { title: 'Thus Spake Zarathustra', url: 'https://www.gutenberg.org/cache/epub/1998/pg1998.txt' },
      { title: 'Beyond Good and Evil', url: 'https://www.gutenberg.org/cache/epub/4363/pg4363.txt' },
    ],
  },
  {
    id: 'darwin', name: 'Charles Darwin', kind: 'savant', lang: 'en',
    era: '1809–1882 · sciences',
    blurb: 'La sélection par l\'épreuve : variations, contraintes du milieu, survie sans garantie.',
    wikipedia: 'Charles Darwin',
    works: [
      { title: 'On the Origin of Species', url: 'https://www.gutenberg.org/cache/epub/2009/pg2009.txt' },
    ],
  },
  {
    id: 'marx', name: 'Karl Marx', kind: 'philosophe', lang: 'en',
    era: '1818–1883 · critique sociale',
    blurb: 'Rapports de force et de travail : qui porte le coût réel, qui capte la valeur.',
    wikipedia: 'Karl Marx',
    works: [
      { title: 'The Communist Manifesto', url: 'https://www.gutenberg.org/cache/epub/61/pg61.txt' },
    ],
  },
  {
    id: 'smith', name: 'Adam Smith', kind: 'économiste', lang: 'en',
    era: '1723–1790 · économie politique',
    blurb: 'Marchés, division du travail et incidence : ce que l\'échange produit et ce qu\'il dégrade.',
    wikipedia: 'Adam Smith',
    works: [
      { title: 'The Wealth of Nations', url: 'https://www.gutenberg.org/cache/epub/3300/pg3300.txt' },
    ],
  },
  {
    id: 'tolstoi', name: 'Léon Tolstoï', kind: 'écrivain', lang: 'en',
    era: '1828–1910 · réalisme',
    blurb: 'La guerre et la paix des grandes décisions : les plans d\'un côté, le réel de l\'autre.',
    wikipedia: 'Léon Tolstoï',
    works: [
      { title: 'War and Peace', url: 'https://www.gutenberg.org/cache/epub/2600/pg2600.txt' },
    ],
  },
  {
    id: 'dostoevski', name: 'Fiodor Dostoïevski', kind: 'écrivain', lang: 'en',
    era: '1821–1881 · roman psychologique',
    blurb: 'Ce que l\'idée fixe fait à celui qui la porte : culpabilité, transgression, compensation.',
    wikipedia: 'Fiodor Dostoïevski',
    works: [
      { title: 'Crime and Punishment', url: 'https://www.gutenberg.org/cache/epub/2554/pg2554.txt' },
    ],
  },
  {
    id: 'cervantes', name: 'Miguel de Cervantès', kind: 'écrivain', lang: 'en',
    era: '1547–1616 · roman moderne',
    blurb: 'L\'écart entre le projet et le monde : l\'idéaliste jugé par les faits, et vice versa.',
    wikipedia: 'Miguel de Cervantes',
    works: [
      { title: 'Don Quixote', url: 'https://www.gutenberg.org/cache/epub/996/pg996.txt' },
    ],
  },
  {
    id: 'spinoza', name: 'Baruch Spinoza', kind: 'philosophe', lang: 'en',
    era: '1632–1677 · rationalisme',
    blurb: 'Comprendre pour cesser de subir : causes, nécessité, joie active contre les passions tristes.',
    wikipedia: 'Baruch Spinoza',
    works: [
      { title: 'Ethics', url: 'https://www.gutenberg.org/cache/epub/3800/pg3800.txt' },
    ],
  },
  {
    id: 'wilde', name: 'Oscar Wilde', kind: 'écrivain', lang: 'en',
    era: '1854–1900 · esthétisme',
    blurb: 'L\'esprit qui démêle la vanité du désir : le prix de l\'apparence et de la volonté.',
    wikipedia: 'Oscar Wilde',
    works: [
      { title: 'The Picture of Dorian Gray', url: 'https://www.gutenberg.org/cache/epub/174/pg174.txt' },
    ],
  },
  {
    id: 'kafka', name: 'Franz Kafka', kind: 'écrivain', lang: 'en',
    era: '1883–1924 · modernité',
    blurb: 'Les procédures qui absorbent les gens : signaux d\'alerte sur la bureaucratie et l\'opacité.',
    wikipedia: 'Franz Kafka',
    works: [
      { title: 'Metamorphosis', url: 'https://www.gutenberg.org/cache/epub/5200/pg5200.txt' },
    ],
  },
]);

export function findAuthorByName(name) {
  const needle = normTitleLite(name);
  if (!needle) return null;
  return LITERARY_AUTHORS.find((author) => {
    const hay = normTitleLite(author.name);
    return hay.includes(needle) || needle.includes(hay);
  }) || null;
}

export function normTitleLite(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findAuthor(id) {
  return LITERARY_AUTHORS.find((author) => author.id === String(id || '').toLowerCase()) || null;
}

export function searchAuthors({ search = '', kind = '', lang = '' } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  return LITERARY_AUTHORS.filter((author) => {
    if (kind && author.kind !== kind) return false;
    if (lang && author.lang !== lang) return false;
    if (!needle) return true;
    return [author.name, author.kind, author.era, author.blurb, author.wikipedia].join(' ').toLowerCase().includes(needle);
  });
}

/** Retire l'entête et le pied Project Gutenberg du texte brut. */
export function stripGutenbergBoilerplate(text) {
  const startMatch = text.match(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i);
  const endMatch = text.match(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (!startMatch && !endMatch) return text;
  const start = startMatch ? startMatch.index + startMatch[0].length : 0;
  const end = endMatch ? endMatch.index : text.length;
  return text.slice(start, end);
}

const STOPWORDS = new Set([
  // élisions et artefacts d'apostrophe
  'quil', 'quils', 'quon', 'quils', 'cest', 'cétait', 'dune', 'dun', 'des', 'du', 'au', 'aux', 'elle', 'il', 'ils', 'je',
  'nous', 'vous', 'on', 'déjà', 'toujours', 'déjà', 'aujourdhui', 'aujourd', 'cestàdire', 'quand', 'puis',
  // français
  'alors', 'aucun', 'aussi', 'autre', 'avec', 'avant', 'avoir', 'bien', 'cela', 'celle', 'celles', 'celui', 'cent', 'cependant',
  'certain', 'ces', 'cet', 'cette', 'ceux', 'chaque', 'comme', 'comment', 'dans', 'depuis', 'deux', 'donc', 'dont', 'elle',
  'elles', 'encore', 'entre', 'etre', 'était', 'était', 'était', 'faire', 'fait', 'fois', 'hors', 'ici', 'juste', 'leur', 'leurs',
  'lors', 'mais', 'meme', 'mes', 'moins', 'mon', 'nos', 'notre', 'nous', 'outre', 'par', 'parce', 'pas', 'peu', 'plus', 'plutot',
  'pour', 'pourquoi', 'près', 'puis', 'quand', 'que', 'quel', 'quelle', 'quelques', 'quoi', 'sans', 'sauf', 'selon', 'ses',
  'seulement', 'sinon', 'soit', 'son', 'sont', 'sous', 'sur', 'tandis', 'tant', 'tellement', 'tous', 'tout', 'toute', 'toutes',
  'très', 'trop', 'une', 'vers', 'voici', 'voilà', 'votre', 'vous', 'cette', 'leur', 'dis', 'dit', 'dit-il', 'chose', 'choses',
  'jour', 'jours', 'temps', 'homme', 'hommes', 'femme', 'yeux', 'tête', ' main', 'grand', 'grande', 'grands', 'petit', 'petite',
  'ainsi', 'avait', 'avaient', 'avant', 'auprès', 'aucune', 'aucuns', 'aussitôt', 'autant', 'autour', 'autrui', 'beaucoup',
  'bien que', 'bientôt', 'cependant', 'cependant que', 'certes', 'chez', 'combien', 'comment', 'davantage', 'dehors', 'dejà',
  'depuis', 'dès', 'désormais', 'dessous', 'dessus', 'durant', 'elle-même', 'elles-mêmes', 'encore', 'enfin', 'ensuite', 'entre',
  'envers', ' environ', 'essentielle', 'essentiellement', 'et', 'est', 'etant', 'etant', 'eu', 'euh', 'excepté', 'hier', 'hors',
  'il', 'ils', 'j', 'jamais', 'je', 'l', 'la', 'le', 'les', 'leur', 'lui', 'là', 'ma', 'maintenant', 'mais', 'malgré', 'me',
  'meme', 'mes', 'moi', 'moins', 'mon', 'même', 'mêmes', 'ne', 'neanmoins', 'nos', 'notre', 'nous', 'ni', 'non', 'notamment',
  'notre', 'nous', 'néanmoins', 'on', 'ont', 'ou', 'où', 'par', 'parce', 'pareil', 'parfois', 'pas', 'pendant', 'pensent',
  'per', 'peu', 'peut', 'peut-être', 'plus', 'plusieurs', 'pour', 'pourquoi', 'près', 'probable', 'puis', 'puisqu', 'puisque',
  'qu', 'quand', 'quant', 'quantième', 'quarante', 'quatorze', 'quatre', 'quatre-vingt', 'quatrième', 'quatre-vingt-dix',
  'quel', 'quelconque', 'quelle', 'quelles', 'quelqu', 'quelque', 'quelques', 'quels', 'qui', 'quiconque', 'quoi', 'quoique',
  'rentre', 's', 'sa', 'sans', 'sauf', 'se', 'sept', 'sera', 'seront', 'ses', 'si', 'sien', 'sinon', 'six', 'soi', 'soixante',
  'soit', 'son', 'sont', 'sous', 'souvent', 'soyez', 'suis', 'suivant', 'sur', 'surtout', 't', 'ta', 'tandis', 'tant', 'tel',
  'telle', 'telles', 'tels', 'tenir', 'tes', 'toi', 'toi-même', 'ton', 'tous', 'tout', 'toute', 'toutefois', 'toutes', 'très',
  'trois', 'trop', 'tu', 'un', 'une', 'unes', 'uns', 'va', 'vais', 'vas', 'vos', 'votre', 'vous', 'vu', 'ça', 'c’était', 'état',
  'était', 'étée', 'êtres', 'être', 'avoir', 'avions', 'avez', 'avaient', 'avant', 'après', 'dire', 'dit', 'voix', 'chose',
  // anglais
  'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'from', 'they', 'she', 'will', 'one', 'all',
  'would', 'there', 'their', 'what', 'out', 'about', 'who', 'get', 'which', 'when', 'make', 'can', 'like', 'time', 'just',
  'him', 'know', 'take', 'into', 'your', 'some', 'could', 'them', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over',
  'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any',
  'these', 'give', 'day', 'most', 'said', 'shall', 'unto', 'thee', 'thou', 'thy', 'hath', 'upon', 'said', 'more', 'very',
  'such', 'were', 'been', 'other', 'was', 'are', 'has', 'had', 'himself', 'herself', 'themselves', 'itself', 'being', 'every',
  'each', 'must', 'much', 'many', 'should', 'where', 'while', 'before', 'between', 'both', 'those', 'than', 'then', 'there',
  'their', 'they', 'them', 'these', 'this', 'that', 'the', 'it', 'is', 'in', 'on', 'of', 'to', 'as', 'at', 'by', 'an', 'or',
  'if', 'so', 'we', 'no', 'do', 'did', 'does', 'done', 'said', 'one', 'two', 'same', 'own', 'again', 'against', 'under',
]);

/** Empreinte lexicale déterministe de la somme des œuvres (texte nettoyé). */
export function literaryFingerprint(texts) {
  const freq = new Map();
  let words = 0;
  for (const text of texts) {
    const tokens = String(text).toLowerCase().normalize('NFC').match(/[\p{L}][\p{L}'’-]{3,}/gu) || [];
    for (const token of tokens) {
      words += 1;
      const key = token.replace(/['’-]/g, '');
      if (key.length < 4 || STOPWORDS.has(key)) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  const terms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([term, count]) => `${term} (${count})`);
  return { words, distinct: freq.size, terms };
}
