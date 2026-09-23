/* Salon — moteur déterministe.
 *
 * Objectif : le fil de discussion répond à LA question posée par l'hôte, dans
 * la mémoire de chaque convive (blurb + méthode + œuvres + passages), sans
 * dépendre d'un modèle stochastique.
 *
 *   scope(question)        → cadrage : sujet, demande, domaine, termes
 *   retrieve(passages, s)  → passages qui répondent à cette question (score lexical)
 *   compose({...})         → PRISE + RÉPLIQUE ancrées (déterministe)
 *   answer({...})          → tour complet : scope → retrieve → compose
 *   persona(author)        → mémoire de l'auteur (pour le prompt LLM)
 *   floorPrompt({...})     → system+user qui portent question, fil, mémoire
 *
 * Même contrat que docs/SALON-AGENT-AUTEUR.md (§3, §4). Aucun aléa, aucun Date.
 * Utilisable côté navigateur (window.SalonEngine) et sous Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SalonEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------ normalisation */

  function stripAccents(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function norm(s) {
    return stripAccents(String(s || "").toLowerCase()).replace(/[\u2019\u2018]/g, "'");
  }

  var STOP = {};
  ("dans cette avec pour plus tout tous toute toutes leur leurs comme mais donc alors ainsi sans sous entre apres avant encore aussi bien tres fait faire etre avoir cela ceux celles nous vous elle elles que qui quoi dont " +
   "quel quelle quels quelles est sont ete etait ont avait the this that with from have has been were which their there about would could should what does your vous notre votre leurs him her its into out over such only also "
  ).split(/\s+/).forEach(function (w) { if (w) STOP[w] = 1; });

  function contentWords(text) {
    var m = norm(text).match(/[a-z][a-z'’-]+/g) || [];
    return m.map(function (w) { return w.replace(/['’-]/g, ""); }).filter(function (w) { return w.length >= 4; });
  }
  function fullWords(text) {
    return contentWords(text).filter(function (w) { return !STOP[w]; });
  }
  /* lemmatisation légère, déterministe */
  function stem(w) {
    var t = w;
    if (t.length > 6) t = t.replace(/(ations?|ements?|iques?|euses?|eux|ance|ence|isme|iste|ite)$/, "");
    if (t.length > 5) t = t.replace(/(ment|tion|sion|eur|euse|ez|es|er|ir|at|is)$/, "");
    if (t.length > 4) t = t.replace(/[sx]$/, "");
    return t;
  }
  function terms(text) {
    var seen = {}, out = [];
    fullWords(text).forEach(function (w) {
      var t = stem(w);
      if (t.length < 4 || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }

  /* --------------------------------------------------------------- cadrage */

  /* Demande (type de question) : ordre = priorité. Déterministe. */
  var DEMANDS = [
    { key: "quantite",   re: /\b(combien|how many|how much|quelle quantite|a quel point)\b/ },
    { key: "cause",      re: /\b(pourquoi|why|d'ou vient|d ou vient|par quelle cause|qu'est-ce qui cause)\b/ },
    { key: "maniere",    re: /\b(comment|how (do|does|can|should)|de quelle maniere|par quels moyens)\b/ },
    { key: "norme",      re: /\b(faut-il|doit-on|doit on|faut il|devrait-on|should|must|ought|a-t-on le droit|peut-on)\b/ },
    { key: "definition", re: /\b(qu'est-ce qu\w*|qu est ce qu\w*|quest-ce qu\w*|what is|what are|que signifie|ce que c'est)/ },
    { key: "verite",     re: /\b(est-ce que|est ce que|est-il vrai|est-il|existe-t-il|y a-t-il|is it|does it|can it|doute)\b/ },
    { key: "valeur",     re: /\b(que vaut|vaut-il|merite|que vaut-il|en vaut|combien vaut)\b/ },
  ];
  function demandOf(q) {
    var t = " " + norm(q).replace(/[?!.;:,]/g, " ") + " ";
    for (var i = 0; i < DEMANDS.length; i++) if (DEMANDS[i].re.test(t)) return DEMANDS[i].key;
    return "these";
  }

  /* Domaines : ordre = priorité, premier match. Chacun porte un topos + une thèse. */
  var DOMAINS = [
    { key: "liberte", label: "la liberté", re: /\b(libre|liberte|autonom|independan|volont|emancip|contrainte|servitude)\w*|\bfree\b|\bfreedom\b/,
      these: "la liberté n'est pas l'absence de contrainte, mais une loi qu'on se donne",
      suite: "il reste à dire qui pose la loi — soi, la cité, ou le besoin" },
    { key: "pouvoir", label: "le pouvoir", re: /\b(pouvoir|gouvern|etat|souverain|autorit|obeir|domin|tyrann|legitim|regime|politique|command)\w*|\bpower\b|\bstate\b/,
      these: "le pouvoir se juge à ce qu'il fait tenir debout, non à ses titres",
      suite: "reste à fixer la borne où l'obéissance cesse d'être un devoir" },
    { key: "justice", label: "la justice", re: /\b(justice|juste|injuste|droit|loi|equite|egalit|punition|chati|proces|tort)\w*|\bjust\b|\blaw\b/,
      these: "le juste ne se confond pas avec le légal, ni le légal avec le fort",
      suite: "reste à dire sur quel critère on reconnaît l'équité quand la loi se tait" },
    { key: "verite", label: "la vérité", re: /\b(verite|vrai|faux|erreur|savoir|connaiss|connaitre|ignorance|preuve|evidence|opinion|croyance|doute|science|raison|entendement)\w*|\btruth\b|\bknowledg/,
      these: "la vérité ne se décrète pas : elle se tient à l'épreuve de ce qui la contredit",
      suite: "reste à choisir l'épreuve : l'expérience, la démonstration, ou l'usage" },
    { key: "conscience", label: "la conscience", re: /\b(conscience|conscient|esprit|ame|pensee|penser|percept|subjectiv|phenomen|mind|mental|ia|intelligence artificielle|algorith|machine|automate|robot)\w*/,
      these: "la conscience se dit en plusieurs sens : il faut d'abord choisir le grain du sujet",
      suite: "reste à nommer le critère : la sortie, la structure, ou le statut moral" },
    { key: "vertu", label: "la vertu", re: /\b(vertu|morale|devoir|obligation|honneur|honnete|caractere|sagesse|prudence|temperance|courage)\w*|\bvirtue\b|\bmoral\b/,
      these: "la vertu n'est pas un mot, c'est un milieu difficile entre deux excès",
      suite: "reste à voir à quelle condition elle devient une habitude et non un effort" },
    { key: "bonheur", label: "le bonheur", re: /\b(bonheur|heureux|plaisir|joie|desir|envie|souffr|malheur|tristess|triste|contentement|jouissance|epicur|ataraxi)\w*|\bhappin|\bpleasure\b/,
      these: "le bonheur n'est pas le plus de plaisirs, mais le moins de troubles",
      suite: "reste à distinguer ce qui dépend de nous de ce qui nous arrive" },
    { key: "education", label: "l'éducation", re: /\b(education|elever|eleve|enfant|ecole|enseign|instruire|apprendre|formation|pedagog)\w*|\beducat|\bchild\b|\bschool\b/,
      these: "on n'instruit pas un esprit comme on remplit un vase",
      suite: "reste à savoir ce qui, dans une éducation, rend l'élève capable de juger seul" },
    { key: "travail", label: "le travail et l'échange", re: /\b(travail|labour|salari|argent|richesse|valeur|marche|echange|propriet|capital|production|economi|commerce|monnaie)\w*|\bwork\b|\bmoney\b|\bwealth\b|\bmarket\b/,
      these: "l'échange produit des valeurs, et il en distribue les charges",
      suite: "reste à savoir qui porte le coût réel et qui en capte le prix" },
    { key: "nature", label: "la nature", re: /\b(nature|natural|environnement|climat|espece|animal|vivant|matiere|ecolog)\w*|\blife\b/,
      these: "la nature ne se contente pas d'être un décor : elle impose ses épreuves",
      suite: "reste à décider ce qui, de la règle ou du milieu, décide de ce qui survit" },
    { key: "religion", label: "la providence et la foi", re: /\b(dieu|providence|foi|croyance|religio|sacr|theolog|eglise|divin|grace|priere|ecriture)\w*|\bgod\b|\bfaith\b/,
      these: "nommer providence ce qui crève l'œil est une commodité, pas une preuve",
      suite: "reste à savoir si le malheur appelle une révérence ou un remède" },
    { key: "amour", label: "l'amour et le désir", re: /\b(amour|aime|aimer|desir|passion|jalousi|mariage|seduct)\w*|\blove\b|\bdesire\b/,
      these: "l'amour mêle l'attachement, le calcul et l'image qu'on veut donner",
      suite: "reste à distinguer le désir d'un autre du désir d'être estimé" },
    { key: "art", label: "l'art et la beauté", re: /\b(oeuvre|beaut|beau|esthtique|poesie|poeme|roman|theatre|musique|peinture|imitation)\w*|\bart\b|\bbeauty\b|\bpoetry\b/,
      these: "l'œuvre ne dit pas la règle : elle en donne la forme visible",
      suite: "reste à savoir si l'art imite le monde ou en instruit la connaissance" },
    { key: "guerre", label: "la guerre et la paix", re: /\b(guerre|paix|arme|combat|ennemi|strateg|victoire|defaite|violence|conflit|bataille)\w*|\bwar\b|\bpeace\b/,
      these: "la victoire parfaite est d'avoir rendu le combat inutile",
      suite: "reste à fixer ce qu'il en coûte de gagner une guerre contre soi-même" },
    { key: "temps", label: "le temps et la mort", re: /\b(temps|mort|mourir|mortel|vieillir|duree|souvenir|memoire|avenir|futur|eternite)\w*|\btime\b|\bdeath\b/,
      these: "le temps ne se possède pas : il se dépense",
      suite: "reste à savoir ce qui, du souvenir ou du projet, donne prix à l'instant" },
  ];
  /* Domaine : on classe par score — nombre de clés trouvées, pondéré par la
   * position (le sujet de la question passe avant l'incise). Déterministe. */
  function domainOf(q) {
    var t = " " + norm(q) + " ";
    var best = null, bestScore = 0;
    for (var i = 0; i < DOMAINS.length; i++) {
      var d = DOMAINS[i];
      var re = new RegExp(d.re.source, "g");
      var count = 0, first = 1e9, m;
      re.lastIndex = 0;
      while ((m = re.exec(t)) !== null) {
        count++;
        if (m.index < first) first = m.index;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (!count) continue;
      var score = count * 1 + 2 / (1 + first / 12);
      if (score > bestScore + 1e-9) { bestScore = score; best = d; }
    }
    return best;
  }

  /* Termes d'expansion par domaine : la mémoire est interrogée non seulement
   * avec les mots de la question, mais avec le vocabulaire du dossier. */
  var DOMAIN_KEYS = {
    liberte: "libre liberte autonom independance volonté contrainte servitude emancipation freedom free liberty autonomy constraint servitude",
    pouvoir: "pouvoir gouverner souverain autorite obeissance domination legitime tyrannie power govern sovereign authority obedience domination tyranny state",
    justice: "justice juste injuste droit loi equite egalite punition chatiement tort justice just injustice right law equity equality punishment wrong",
    verite: "verite vrai faux erreur savoir connaissance preuve evidence opinion doute truth true false error knowledge proof evidence opinion doubt science reason understanding",
    conscience: "conscience esprit pensee perception experience sujet matiere conscience mind spirit thought perception experience subject matter",
    vertu: "vertu morale devoir obligation honneur sagesse prudence courage temperance virtue moral duty obligation honour honesty wisdom prudence courage",
    bonheur: "bonheur plaisir joie desir souffrance malheur trouble tranquillite happiness pleasure joy desire suffering misery trouble tranquillity",
    education: "education elever enfant instruction apprentissage formation jugement education child school teaching learning training judgement",
    travail: "travail labeur salaire argent richesse valeur echange propriete capital production commerce work labour wage money wealth value exchange property capital commerce",
    nature: "nature vivant espece animal climat milieu environnement nature life species animal climate environment",
    religion: "dieu providence foi croyance religion sacre divin grace ecriture god providence faith belief religion sacred divine grace scripture",
    amour: "amour aimer desir passion jalousie mariage attachement love desire passion jealousy marriage attachment",
    art: "oeuvre art beaute poesie recit roman theatre image imitation art beauty poetry story novel theatre image imitation",
    guerre: "guerre paix arme combat ennemi strategie victoire defaite violence war peace weapon combat enemy strategy victory defeat violence",
    temps: "temps mort duree souvenir memoire avenir eternite vieillesse time death duration memory future eternity old age",
    generique: "question sujet these raison consequence question subject thesis reason consequence",
  };

  function scope(question) {
    var raw = String(question || "").trim();
    var dom = domainOf(raw);
    var tms = terms(raw);
    var demand = demandOf(raw);
    var subject = dom ? dom.label : (tms.length ? tms[0] : "la question");
    return {
      raw: raw,
      lang: /\b(the|what|how|why|is|are|of|to|should|must|does|and|with)\b/.test(norm(raw)) && !/\b(le|la|les|que|qui|est|une|des|pour)\b/.test(norm(raw)) ? "en" : "fr",
      terms: tms,
      subject: subject,
      demand: demand,
      domain: dom ? dom.key : "generique",
      keys: dom ? terms(DOMAIN_KEYS[dom.key] || "") : terms(DOMAIN_KEYS.generique),
      label: dom ? dom.label : subject,
      these: dom ? dom.these : "",
      suite: dom ? dom.suite : "",
      concepts: conceptsIn(raw),
    };
  }

  var CONCEPTS = [
    [/autonom|independan|libre|liberte|emancip/, "liberté"],
    [/volont/, "volonté"],
    [/conscience|esprit|pensee/, "conscience"],
    [/raison|entendement|logique/, "raison"],
    [/vertu|morale|devoir/, "vertu"],
    [/providence|dieu|foi/, "providence"],
    [/nature|vivant|espece/, "nature"],
    [/contrat|souverain|etat|pouvoir/, "souveraineté"],
    [/definition|signifie|qu'est-ce/, "définition"],
    [/justice|droit|loi|equite/, "justice"],
    [/bonheur|plaisir|desir/, "bonheur"],
    [/savoir|verite|preuve|connaiss/, "connaissance"],
  ];
  function conceptsIn(text) {
    var t = norm(text), out = [];
    for (var i = 0; i < CONCEPTS.length; i++) {
      if (CONCEPTS[i][0].test(t) && out.indexOf(CONCEPTS[i][1]) < 0) out.push(CONCEPTS[i][1]);
    }
    return out.slice(0, 4);
  }

  /* ------------------------------------------------------------ passages */

  function sentencesOf(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];
    return clean
      .split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ])/u)
      .map(function (s) { return s.replace(/^["«“„]\s*/, "").replace(/\s*["»”]\s*$/, "").trim(); })
      .filter(function (s) { return s.length >= 24; });
  }
  function firstSentences(text, max) {
    return sentencesOf(text).slice(0, max || 2).join(" ");
  }
  function cleanSentence(s) {
    if (!s) return false;
    if (/[\[\]{}_*]|\[[0-9]+\]|éditio|editions?|qu'on lit|première édition|p\.\s?\d|https?:|^\W/.test(s)) return false;
    if (!/^[A-ZÀ-ÖØ-Þ]/.test(s)) return false;
    if (!/[.!?»"]$/.test(s)) return false;
    if (s.length < 40 || s.length > 320) return false;
    var letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters / s.length < 0.68) return false;
    return true;
  }
  /* Phrase entière bien formée : majuscule initiale, ponctuation finale, sans
   * résidu d'OCR ni note d'éditeur. Corrige l'ancrage au milieu d'une phrase. */
  function bestSentence(text) {
    var ss = sentencesOf(text);
    for (var i = 0; i < ss.length; i++) if (cleanSentence(ss[i])) return ss[i];
    var parts = String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
    for (var j = 0; j < parts.length; j++) {
      var s = parts[j].replace(/^["«“„]\s*/, "").trim();
      if (cleanSentence(s)) return s;
    }
    return "";
  }

  function relevance(query, text) {
    var q = {}, n = 0;
    terms(query).forEach(function (t) { if (!q[t]) { q[t] = 1; n++; } });
    if (!n) return 0;
    var words = terms(text);
    if (!words.length) return 0;
    var hit = 0;
    for (var i = 0; i < words.length; i++) if (q[words[i]]) hit++;
    return hit / Math.sqrt(n * Math.max(words.length, 8));
  }

  function retrieve(passages, sc, k) {
    var qRank = [sc.raw, sc.label || "", (sc.keys || []).join(" ")].join(" ");
    var qGate = [sc.raw, sc.label || ""].join(" ");
    var ranked = (passages || []).map(function (p, i) {
      var work = p.w || p.work || "";
      var text = p.t || p.text || p.s || "";
      var sent = p.s || bestSentence(text);
      var sGate = relevance(qGate, (work || "") + " " + sent);
      var sRank = relevance(qRank, work + " " + text);
      return { work: work, text: text, sentence: sent, score: sGate * 2 + sRank, gate: sGate, i: i };
    });
    ranked.sort(function (a, b) { return (b.score - a.score) || (a.i - b.i); });
    ranked = ranked.slice(0, Math.max(1, k || 3));
    ranked.forEach(function (p) { p.weak = !p.sentence || (p.gate != null ? p.gate : relevance(qGate, (p.work || "") + " " + p.sentence)) < 0.10; });
    return ranked;
  }

  /* ------------------------------------------------------------- parole */

  function closeSentence(t) {
    var s = String(t || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?…»"]$/.test(s)) s += ".";
    return s;
  }
  function compactQuestion(q, max) {
    var s = String(q || "").replace(/\s+/g, " ").trim().replace(/[.?!\s]+$/, "");
    max = max || 120;
    return s.length > max ? s.slice(0, max - 1).trim() + "…" : s;
  }
  function nameOf(a, lang) {
    if (!a) return "l'inconnu";
    return (lang === "en" && a.nameEn) ? a.nameEn : (a.name || a.id || "l'inconnu");
  }

  /* Thèse propre à (domaine, type de demande) — table déterministe. */
  var THESES = {
    liberte: { definition: "être libre, ce n'est pas faire ce qu'on veut, c'est vouloir ce qu'on fait", norme: "on ne force personne à être libre sans lui ôter la liberté" },
    pouvoir: { norme: "qui gouverne doit d'abord rendre compte de ce qu'il fait tenir", definition: "le pouvoir n'est légitime que lorsqu'il peut être contesté" },
    justice: { definition: "le juste n'est pas ce que le plus fort appelle ainsi", norme: "on n'obéit à une loi injuste qu'en travaillant à la changer" },
    verite: { definition: "est vrai ce qui résiste à l'épreuve qu'on lui oppose", cause: "l'erreur vient moins de l'ignorance que de la précipitation" },
    conscience: { definition: "la conscience se dit en plusieurs sens, et confondre les sens fabrique les paradoxes" },
    vertu: { norme: "la vertu se mesure au milieu, entre deux excès également perdus" },
    bonheur: { definition: "le bonheur tient au peu de troubles plus qu'au nombre des plaisirs" },
    education: { maniere: "on forme un jugement par l'exercice, non par la leçon" },
    travail: { cause: "la valeur se capte là où le coût retombe sur d'autres" },
    nature: { cause: "ce qui survit n'a pas demandé la permission de vaincre" },
    religion: { definition: "appeler providence le scandale du monde est une consolation, pas une preuve" },
    amour: { definition: "aimer, c'est vouloir du bien à l'autre, non l'image qu'on en tire" },
    art: { definition: "l'œuvre ne prouve pas : elle rend visible" },
    guerre: { norme: "la meilleure victoire est celle qui rend le combat inutile" },
    temps: { definition: "le temps ne se possède pas ; il se dépense" },
    generique: {},
  };
  /* Thèse : d'abord celle de l'AUTEUR (sa mémoire), cadrée par la demande ;
   * le domaine ne sert que de repli. C'est ce qui distingue les voix. */
  function authorThesis(author) {
    var blurb = String((author && (author.blurb || author.blurbEn)) || "").replace(/\s+/g, " ").trim();
    if (!blurb) return "";
    var idx = blurb.search(/[.:—]/);
    var head = idx > 18 ? blurb.slice(idx + 1) : blurb;
    head = head.replace(/\.\s*$/, "").trim();
    if (head.length < 12) head = blurb.replace(/\.\s*$/, "");
    return head;
  }
  function thesisFor(sc, author) {
    var own = authorThesis(author);
    if (own) return own;
    var table = THESES[sc.domain] || {};
    if (table[sc.demand]) return table[sc.demand];
    if (table.definition) return table.definition;
    if (sc.these) return sc.these;
    return "\"" + (sc.label || "la question") + "\" demande d'abord d'être circonscrite";
  }
  /* La demande colore l'énoncé de la thèse (norme, définition, cause…). */
  function phraseFor(sc, author) {
    var base = thesisFor(sc, author);
    var d = sc.demand;
    if (d === "norme") return "sur ce qu'il faut faire, ma règle est simple : " + base;
    if (d === "definition") return "je réponds par une définition : " + base;
    if (d === "cause") return "la cause, à mon sens, se dit ainsi : " + base;
    if (d === "maniere") return "cela se fait par degrés : " + base;
    if (d === "verite") return "la réponse tient à ceci : " + base;
    return base;
  }
  /* On cite le point de l'autre sans son habillage de demande. */
  function stripWrapper(s) {
    return String(s || "").replace(/^(sur ce qu'il faut faire, ma règle est simple : |je réponds par une définition : |la cause, à mon sens, se dit ainsi : |cela se fait par degrés : |la réponse tient à ceci : )/i, "");
  }

  /* Planificateur dialectique : qui parle, à qui, sur quel point, avec quel acte.
   * C'est ce qui donne une LOGIQUE aux rapports entre auteurs (objection ciblée,
   * défense contre l'objection, minute finale), au lieu d'un ordre positionnel. */
  function lastGuest(history) {
    var h = history || [];
    for (var i = h.length - 1; i >= 0; i--) { if (!h[i].host && h[i].name) return h[i]; }
    return null;
  }
  function planTurn(input) {
    input = input || {};
    var role = input.role || "invite";
    var prev = lastGuest(input.history);
    var host = input.lang === "en" ? "the host" : "l’hôte";
    var toName = prev ? prev.name : host;
    var point = prev ? (prev.prise || prev.text || "") : "";
    var move = "ouvre", act = "reponse";
    if (role === "objecteur") { move = "objecte"; act = "objection"; }
    else if (role === "defenseur") { move = "precise"; act = "reponse"; }
    else if (role === "secretaire") { move = "minute"; act = "reponse"; }
    else if (prev) { move = "ajoute"; act = "reponse"; }
    return { move: move, act: act, toName: toName, point: point };
  }

  function compose(input) {
    var author = input.author || {};
    var sc = input.scope || scope(input.question || "");
    var lang = input.lang || sc.lang || "fr";
    var act = input.act || "reponse";
    var method = input.method || author.method || "auto";
    var passage = input.passage;
    var last = input.lastTurn;
    var self = input.self || [];
    var selfLast = self.length ? (self[self.length - 1].prise || "") : "";
    var move = input.move || (act === "objection" ? "objecte" : "ouvre");
    var question = input.question || sc.raw || "";
    var subject = sc.label || sc.subject || "la question";
    var qc = compactQuestion(question);
    var toName = input.toName || (last && last.name) || (lang === "en" ? "the host" : "l’hôte");
    var point = input.point || (last && last.prise) || "";

    var work = passage && passage.work ? passage.work : "";
    var sentence = passage && passage.sentence ? passage.sentence : "";
    var grounded = Boolean(work && sentence) && !(passage && passage.weak);

    var prise = "";
    var clauses = [];
    var toLow = function (s) { return stripWrapper(compactQuestion(s, 110)).replace(/^[A-ZÀ-Ý]/, function (c) { return c.toLowerCase(); }); };

    /* 1. Ressaisir — nommer à qui l'on parle et le point qu'il a posé. */
    if (move === "objecte") {
      clauses.push(toName + ", tu soutiens que " + toLow(point || subject) + " — je ne l’accorde pas encore.");
    } else if (move === "precise") {
      clauses.push(toName + ", ton objection portait sur ce point : " + toLow(point || subject) + ". Je précise.");
    } else if (move === "minute") {
      clauses.push("Je reprends la table pour la minute : la question reste « " + qc + " ».");
    } else if (last && last.prise) {
      clauses.push(toName + ", je reprends ton point : " + toLow(last.prise) + ".");
    } else {
      clauses.push("L’hôte demande : " + qc + ".");
    }
    if (move !== "minute") clauses.push("Je le garde pour fil : il s’agit de " + subject + ", non d’un autre dossier.");

    /* 2. Position — la thèse du convive (elenchus : définir, ne pas conclure). */
    if (method === "elenchus") {
      prise = "Je ne tiens pas encore la définition que tu mets sous ces mots.";
      clauses.push("Avant de conclure, dis-moi ce que tu mets sous « " + subject + " » : une seule chose, ou plusieurs que l’on confond ?");
    } else {
      var th = thesisFor(sc, author);
      prise = closeSentence(th);
      clauses.push((selfLast ? "Comme je le tenais déjà : " : "Ma prise, sur ce point : ") + th + ".");
    }

    /* 3. Ancrer — une œuvre nommée, une phrase entière, ou l'aveu du manque. */
    if (grounded) {
      clauses.push("Mon lieu est « " + work + " » : " + sentence);
    } else {
      var wl = (author.works && author.works.length) ? (author.works[0].title || author.works[0]) : "";
      clauses.push(wl
        ? "Le passage le plus proche ne tranche pas cette question ; je m’en tiens donc à ce que je peux signer depuis « " + wl + " », sans citer à faux."
        : "Aucun de mes livres ne tranche ici : je ne fabrique pas de citation.");
    }

    /* 4. Avancer — conséquence ou question courte, adressée à celui à qui l'on parle. */
    var suite = String(sc.suite || "").replace(/^(il )?reste à /, "");
    if (method === "elenchus") {
      clauses.push("Tiens-tu cette définition jusqu’au bout, ou la vois-tu déjà se défaire ?");
    } else if (move === "objecte") {
      clauses.push("Ce n’est pas ta personne que je presse, " + toName + " : c’est ce que ta phrase ne peut plus soutenir.");
    } else if (move === "precise") {
      clauses.push("Tiens-tu ton objection jusqu’au bout, " + toName + ", ou faut-il distinguer davantage ?");
    } else if (move === "minute") {
      clauses.push("Voilà les nœuds encore ouverts ; à la table de trancher.");
    } else if (suite) {
      clauses.push("Ce qui reste à décider : " + suite + ".");
    } else if (last) {
      clauses.push("Voilà ce que je signe sur ton point, " + toName + "; la suite est à qui voudra la reprendre.");
    } else {
      clauses.push("Voilà ce que je signe ; la suite est à qui voudra objecter.");
    }

    return { prise: prise, text: clauses.join(" "), grounded: grounded };
  }

  function answer(input) {
    var author = input.author || {};
    var sc = input.scope || scope(input.question || "");
    var passages = input.passages || retrieve(input.corpus || [], sc, 3);
    var best = passages[0];
    var last = (input.history && input.history.length) ? input.history[input.history.length - 1] : null;
    var plan = (input.move || input.toName)
      ? { move: input.move || "ouvre", act: input.act || "reponse", toName: input.toName, point: input.point }
      : planTurn({ role: input.role, history: input.history, lang: input.lang });
    var out = compose({
      author: author, scope: sc, passage: best, lastTurn: last,
      act: plan.act, move: plan.move, toName: plan.toName, point: plan.point,
      self: input.self, method: input.method || author.method, lang: input.lang,
    });
    return { text: out.text, prise: out.prise, grounded: out.grounded, scope: sc, passage: best || null };
  }

  /* -------------------------------------------------------------- prompt */

  var FIGURES = {
    concessio: "accorde d’abord un point, puis retourne la thèse par une distinction tirée d’une œuvre",
    distinctio: "isole un mot de la réplique précédente ; dis ce qu’il ne veut pas dire, puis ce qu’il veut dire chez toi",
    interrogatio: "deux questions courtes à ton interlocuteur, puis une assertion née d’une œuvre nommée",
    ironia: "un éloge qui pique, ou une politesse trop exacte ; jamais de moquerie lourde",
    sententia: "une maxime courte, puis son prix — ce qu’elle coûte à qui la tient",
    hypotypose: "une image concrète tirée de tes livres, vue, pas commentée ; ensuite le jugement",
    exemplum: "un cas nommé dans une œuvre, pas une loi ; le cas porte l’argument",
  };
  function figureFor(seed) {
    var keys = ["exemplum", "distinctio", "concessio", "sententia", "hypotypose", "interrogatio", "ironia"];
    var h = 0, s = String(seed || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return keys[h % keys.length];
  }

  function persona(author, lang) {
    if (!author) return "";
    var en = lang === "en";
    var name = nameOf(author, lang);
    var kind = author.kind || "philosophe";
    var era = en ? (author.eraEn || author.era || "") : (author.era || "");
    var blurb = en ? (author.blurbEn || author.blurb || "") : (author.blurb || "");
    var works = (author.works || []).map(function (w) { return w.title || w; }).slice(0, 6);
    var method = author.method === "elenchus" ? (en ? "elenchus (ask, do not conclude)" : "elenchus (interroger, ne pas conclure)") : "auto";
    return [
      (en ? "You are " : "Tu es ") + name + (kind ? " — " + kind : "") + (era ? " (" + era + ")" : "") + ".",
      blurb ? (en ? "Thesis: " : "Thèse : ") + blurb : "",
      (en ? "Method: " : "Méthode : ") + method + ".",
      works.length ? (en ? "Works in memory: " : "Œuvres en mémoire : ") + works.join("; ") : "",
      (en ? "You are a guest at a table, not a chatbot." : "Tu es un convive à une table, pas un chatbot."),
    ].filter(Boolean).join("\n");
  }

  function floorPrompt(input) {
    var sc = input.scope || scope(input.question || "");
    var lang = input.lang || sc.lang || "fr";
    var en = lang === "en";
    var author = input.author;
    var _plan = input.move ? { move: input.move, act: input.act || "reponse", toName: input.toName, point: input.point } : planTurn({ role: input.role, history: input.history, lang: lang });
    var act = _plan.act || input.act || "reponse";
    var move = _plan.move || "ouvre";
    var toName = input.toName || _plan.toName || (en ? "the host" : "l’hôte");
    var point = input.point || _plan.point || "";
    var last = (input.history && input.history.length) ? input.history[input.history.length - 1] : null;
    var fig = figureFor((author && author.id) + "|" + sc.domain + "|" + sc.demand);
    var passages = input.passages || [];

    var system = [
      persona(author, lang),
      "",
      en
        ? "Contract: reply with exactly two fields —\nPRISE: <one assertive sentence: the thesis THIS turn adds to the table question>\nREPLIQUE:\n<90-170 words, complete sentences, first person, no lists, no headings>"
        : "Contrat : réponds exactement dans deux champs —\nPRISE: <une phrase assertive : la thèse que CE tour ajoute à la question de table>\nREPLIQUE:\n<90 à 170 mots, phrases complètes, première personne, sans liste, sans titre>",
      "",
      (en ? "Order (do not name it): reconnect what was just said; take a stand; ground in ONE named work (at most one whole sentence); move the thread on." : "Ordre, sans le nommer : ressaisir ce qui vient d’être dit ; prendre position ; ancrer dans UNE œuvre nommée (au plus une phrase entière) ; faire avancer le fil."),
      (en ? "Figure (do not name it): " : "Figure (ne la nomme pas) : ") + (FIGURES[fig] || FIGURES.exemplum) + ".",
      (author && author.method === "elenchus"
        ? (en ? "Elenchus: do not profess; ask one question that makes the other's own definition contradict itself; stop in aporia." : "Elenchus : ne professe pas ; pose une seule question qui met la définition de l’autre en contradiction avec elle-même ; arrête-toi dans l’aporie.")
        : ""),
      (en ? "Never quote a passage that does not answer the question; never invent a work or a quote." : "Ne cite jamais un passage qui ne répond pas ; ne fabrique ni œuvre ni citation."),
    ].filter(Boolean).join("\n");

    var user = [
      (en ? "Table question (the thread — do not leave it): " : "Question de table (fil directeur — ne la quitte pas) : ") + sc.raw,
      (en ? "Scope: subject = " : "Cadrage : sujet = ") + (sc.label || sc.subject) + " ; " + (en ? "kind of question = " : "type de demande = ") + sc.demand + ".",
      last
        ? (en ? "Previous turn to build on: " : "Dernier tour à enchaîner : ") + nameOf(last.author ? { name: last.author } : { name: last.name }, lang) + (last.prise ? " — " + (en ? "thesis: " : "prise : ") + last.prise : "") + ". " + (last.text || "")
        : (en ? "You open the table: restate the question, then take a stand." : "Tu ouvres la table : ressaisis la question, puis prends position."),
      (en ? "Move: " : "Acte : ") + move + (en ? ". Address " : ". Tu t’adresses à ") + toName +
        (point ? ((en ? "; answer their point: " : " ; réponds à son point : ") + compactQuestion(point, 110)) : "") +
        (move === "objecte"
          ? (en ? "; object to their THESIS, not to another problem." : " ; objecte à SA PRISE, pas à un autre problème.")
          : move === "minute"
            ? (en ? "; summarise question, theses, open knots." : " ; minute : question, prises tenues, nœuds ouverts.")
            : "."),
      passages.length
        ? (en ? "Passages (use at most one, only if it answers):\n" : "Passages (au plus un, seulement s’il répond) :\n") +
          passages.slice(0, 3).map(function (p) { return "« " + p.work + " »\n" + (p.sentence || firstSentences(p.text, 1)); }).join("\n\n")
        : (en ? "No relevant passage — say so, then argue from your named works." : "Aucun passage pertinent — dis-le, puis argumente depuis tes œuvres nommées."),
      (input.self && input.self.length)
        ? (en ? "Your own previous turns (stay consistent; do not repeat yourself):\n" : "Ta mémoire — tes tours précédents (reste cohérent, ne te répète pas) :\n") + input.self.slice(-4).map(function (h) { return (h.prise ? "[" + (en ? "thesis: " : "prise : ") + h.prise + "] " : "") + (h.text || ""); }).join("\n")
        : "",
      (input.history && input.history.length > 1)
        ? (en ? "Recent thread:\n" : "Fil récent :\n") + input.history.slice(-6).map(function (h) {
            return nameOf({ name: h.name, nameEn: h.nameEn }, lang) + (h.prise ? " [" + (en ? "thesis: " : "prise : ") + h.prise + "]" : "") + " : " + h.text;
          }).join("\n")
        : "",
    ].filter(Boolean).join("\n\n");

    return { system: system, user: user, figure: fig, scope: sc };
  }

  function parseSpeech(raw) {
    var src = String(raw || "").replace(/\r\n/g, "\n").trim();
    var pm = src.match(/^\s*PRISE\s*:\s*(.+?)(?:\n|$)/i);
    var bm = src.match(/REPLIQUE\s*:\s*([\s\S]+)/i);
    var prise = (pm && pm[1] ? pm[1] : "").replace(/^["«]+|["»]+$/g, "").trim();
    var text = (bm && bm[1] ? bm[1] : "").trim();
    if (!text) text = src.replace(/^\s*PRISE\s*:.*$/im, "").replace(/^\s*REPLIQUE\s*:\s*/im, "").trim();
    text = String(text).replace(/\s+/g, " ").trim();
    if (!prise) prise = firstSentences(text, 1).slice(0, 220);
    if (prise.length > 240) prise = prise.slice(0, 237).trim() + "…";
    return { prise: prise, text: text };
  }

  return {
    version: "1.0.0",
    scope: scope,
    terms: terms,
    conceptsIn: conceptsIn,
    domainOf: domainOf,
    demandOf: demandOf,
    retrieve: retrieve,
    relevance: relevance,
    bestSentence: bestSentence,
    cleanSentence: cleanSentence,
    sentencesOf: sentencesOf,
    firstSentences: firstSentences,
    compose: compose,
    answer: answer,
    planTurn: planTurn,
    lastGuest: lastGuest,
    persona: persona,
    floorPrompt: floorPrompt,
    figureFor: figureFor,
    parseSpeech: parseSpeech,
    nameOf: nameOf,
  };
});
