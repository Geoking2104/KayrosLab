export const LOCALES = { en: 'English', fr: 'Français' };

const translations = {
  en: {
    app: {
      title: 'Positionner',
      subtitle: 'Ontological Competitive Analysis',
      beta: 'Beta',
      ontology: 'Ontology Playground',
      analyze: 'Analyze',
      analyzing: 'Collecting and scoring...',
      emptyTitle: 'Enter an idea and click',
      emptyDesc: 'to explore the competitive positioning ontology.',
      features: [
        '14 entity types', '13 oriented relationships',
        'Cytoscape.js graph', 'Query Playground', 'OWL RDF/XML Export',
      ],
      activeCompetitor: 'Active competitor:',
      ourIdea: 'Our idea',
      tabs: { graph: 'Graph', query: 'Query Playground', gaps: 'Gap Analysis', export: 'Export' },
      graph: { clickHint: 'Click a node to inspect its properties', selectHint: 'Also select a competitor to see data bindings' },
      inspector: {
        properties: 'Properties', relations: 'Relations', relationshipFrom: 'from',
        cardinality: 'Cardinality', instances: 'Competitor instances',
        noRelations: 'No relations', values: 'Values',
      },
      gaps: { title: 'Differentiation Gaps', subtitle: 'Baseline vs competitor average (threshold 5 pts)' },
      query: {
        placeholder: 'Ask a question in English...',
        suggestionPrefix: 'Show me all competitors',
      },
      export: { json: 'JSON Ontology', owl: 'OWL RDF/XML' },
      dashboard: {
        tab: 'Dashboard',
        title: 'Strategic Portfolio Dashboard',
        total: 'Total Ideas',
        active: 'Active',
        abandoned: 'Abandoned',
        abandonRate: 'Abandonment Rate',
        avgKi: 'Avg KI',
        stageDist: 'Stage Distribution',
        statusDist: 'Status Distribution',
        funnel: 'Conversion Funnel',
        stage: 'Stage',
        count: 'Count',
        conversion: 'Conversion',
        timing: 'Avg Time per Stage',
        days: 'days',
        financialTitle: 'Financial Portfolio',
        invested: 'Invested',
        benefit: 'Benefit',
        net: 'Net',
        roi: 'ROI',
        topIdeas: 'Top Ideas by KI',
        noData: 'No ideas yet — analyze a project to see dashboard data.',
      },
    },
  },
  fr: {
    app: {
      title: 'Positionner',
      subtitle: 'Analyse concurrentielle ontologique',
      beta: 'Bêta',
      ontology: 'Ontology Playground',
      analyze: 'Analyser',
      analyzing: 'Collecte et scoring en cours...',
      emptyTitle: 'Entrez une idée et cliquez sur',
      emptyDesc: "pour explorer l'ontologie de positionnement concurrentiel.",
      features: [
        '14 types d\'entités', '13 relations orientées',
        'Graphe Cytoscape.js', 'Query Playground', 'Export OWL RDF/XML',
      ],
      activeCompetitor: 'Concurrent actif :',
      ourIdea: 'Notre idée',
      tabs: { graph: 'Graphe', query: 'Query Playground', gaps: 'Gap Analysis', export: 'Export' },
      graph: { clickHint: 'Cliquez sur un nœud pour inspecter ses propriétés', selectHint: 'Sélectionnez aussi un concurrent pour voir ses data bindings' },
      inspector: {
        properties: 'Propriétés', relations: 'Relations', relationshipFrom: 'depuis',
        cardinality: 'Cardinalité', instances: 'Instances concurrentes',
        noRelations: 'Aucune relation', values: 'Valeurs',
      },
      gaps: { title: 'Écarts de différenciation', subtitle: 'Baseline vs moyenne des concurrents (seuil ≥ 5 pts)' },
      query: {
        placeholder: 'Posez une question en anglais...',
        suggestionPrefix: 'Montre-moi tous les concurrents',
      },
      export: { json: 'JSON Ontologie', owl: 'Export OWL RDF/XML' },
      dashboard: {
        tab: 'Dashboard',
        title: 'Tableau de bord stratégique',
        total: 'Idées totales',
        active: 'Actives',
        abandoned: 'Abandonnées',
        abandonRate: "Taux d'abandon",
        avgKi: 'KI moyen',
        stageDist: 'Répartition par étape',
        statusDist: 'Répartition par statut',
        funnel: 'Entonnoir de conversion',
        stage: 'Étape',
        count: 'Nombre',
        conversion: 'Conversion',
        timing: 'Temps moyen par étape',
        days: 'jours',
        financialTitle: 'Portefeuille financier',
        invested: 'Investi',
        benefit: 'Bénéfice',
        net: 'Net',
        roi: 'ROI',
        topIdeas: 'Meilleures idées par KI',
        noData: 'Aucune idée — analysez un projet pour voir le tableau de bord.',
      },
    },
  },
};

export function t(locale, keyPath, fallback = '') {
  const keys = keyPath.split('.');
  let val = translations[locale];
  for (const k of keys) {
    if (val == null) return fallback;
    val = val[k];
  }
  return val ?? fallback;
}

export function useI18n(locale) {
  return {
    locale,
    t: (key, fallback) => t(locale, key, fallback),
    isRtl: false,
  };
}
