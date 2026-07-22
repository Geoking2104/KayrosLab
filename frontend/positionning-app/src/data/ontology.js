export const ENTITY_TYPES = [
  { id: 'architecture',    name: 'Architecture',    description: 'Le pattern architectural et la structure technique du produit',     icon: '🏗️', color: '#D83B01', group: 'tech',
    properties: [
      { name: 'pattern', type: 'enum',     values: ['monolith','modular','microservices','event-driven'], isIdentifier: true },
      { name: 'coupling',   type: 'string'  },
      { name: 'scalability', type: 'string'  },
    ]},
  { id: 'stack',           name: 'Stack',           description: 'Langages, frameworks, bases de données et infrastructure',          icon: '🛠️', color: '#0078D4', group: 'tech',
    properties: [
      { name: 'languages',  type: 'string'  },
      { name: 'frameworks', type: 'string'  },
      { name: 'database',   type: 'string'  },
      { name: 'cloud',      type: 'string'  },
      { name: 'ci_cd',      type: 'string'  },
    ]},
  { id: 'data_layer',      name: 'Data Layer',      description: 'Stockage, pipeline, vector store et gestion des données',          icon: '💾', color: '#107C10', group: 'tech',
    properties: [
      { name: 'storage_type', type: 'enum', values: ['relational','nosql','graph','vector'] },
      { name: 'pipeline',     type: 'string'  },
      { name: 'caching',      type: 'string'  },
      { name: 'vector_store', type: 'boolean' },
    ]},
  { id: 'security',        name: 'Security',        description: 'Chiffrement, authentification, conformité et gouvernance',         icon: '🔒', color: '#5C2D91', group: 'tech',
    properties: [
      { name: 'encryption', type: 'enum', values: ['none','transit','rest','both'] },
      { name: 'auth',       type: 'string'  },
      { name: 'compliance', type: 'string'  },
      { name: 'hds',        type: 'boolean' },
      { name: 'nis2',       type: 'boolean' },
    ]},
  { id: 'ia_ml',           name: 'IA / ML',         description: 'Modèles, RAG, fine-tuning et capacité d\'inférence',               icon: '🤖', color: '#00A9E0', group: 'tech',
    properties: [
      { name: 'models',      type: 'string'  },
      { name: 'rag',         type: 'boolean' },
      { name: 'fine_tuning', type: 'boolean' },
      { name: 'training',    type: 'string'  },
      { name: 'inference',   type: 'string'  },
    ]},
  { id: 'scale_perf',      name: 'Scale & Perf',    description: 'Throughput, latence, concurrence et montée en charge',              icon: '⚡', color: '#FFB900', group: 'tech',
    properties: [
      { name: 'throughput',  type: 'string'  },
      { name: 'latency_ms',  type: 'integer' },
      { name: 'concurrency', type: 'string'  },
      { name: 'sla',         type: 'decimal' },
    ]},
  { id: 'api_surface',     name: 'API Surface',     description: 'Protocoles, endpoints, SDK et capacité d\'intégration',             icon: '🔌', color: '#008272', group: 'tech',
    properties: [
      { name: 'protocols',  type: 'enum', values: ['rest','graphql','grpc','websocket'] },
      { name: 'versioning', type: 'string'  },
      { name: 'sdk',        type: 'boolean' },
      { name: 'openapi',    type: 'boolean' },
    ]},
  { id: 'business_model',  name: 'Business Model',  description: 'Le modèle économique et la stratégie de mise sur le marché',        icon: '💼', color: '#0078D4', group: 'business',
    properties: [
      { name: 'type',     type: 'enum', values: ['saas','paas','iaas','marketplace','hybrid'] },
      { name: 'maturity', type: 'enum', values: ['seed','early','growth','mature'] },
    ]},
  { id: 'pricing',         name: 'Pricing',          description: 'Stratégie de tarification et structure de prix',                    icon: '💰', color: '#107C10', group: 'business',
    properties: [
      { name: 'model',       type: 'enum', values: ['subscription','usage','tiered','flat','freemium'] },
      { name: 'entry_price', type: 'decimal'  },
      { name: 'per_seat',    type: 'boolean'  },
      { name: 'trial_days',  type: 'integer'  },
    ]},
  { id: 'go_to_market',    name: 'Go-to-Market',    description: 'Canaux de distribution et modèle de vente',                         icon: '🚀', color: '#D83B01', group: 'business',
    properties: [
      { name: 'channel',      type: 'enum', values: ['direct','partner','marketplace','hybrid'] },
      { name: 'sales_model',  type: 'enum', values: ['self','inside','field'] },
      { name: 'geography',    type: 'string'  },
    ]},
  { id: 'icp',             name: 'ICP',              description: 'Segment de clientèle cible et persona',                            icon: '👤', color: '#5C2D91', group: 'business',
    properties: [
      { name: 'segment',       type: 'enum', values: ['smb','mid','enterprise','all'] },
      { name: 'persona',       type: 'string'  },
      { name: 'vertical',      type: 'string'  },
      { name: 'employees_min', type: 'integer'  },
    ]},
  { id: 'revenue_model',   name: 'Revenue',          description: 'Structure de revenus et flux de monétisation',                     icon: '📈', color: '#008272', group: 'business',
    properties: [
      { name: 'subscription',  type: 'boolean' },
      { name: 'transactional', type: 'boolean' },
      { name: 'marketplace',   type: 'boolean' },
      { name: 'arr_estimate',  type: 'string'  },
    ]},
  { id: 'customer_success', name: 'Customer Success', description: 'Support, onboarding, communauté et rétention',                    icon: '🤝', color: '#00A9E0', group: 'business',
    properties: [
      { name: 'support_tier',  type: 'enum', values: ['self','chat','email','phone','dedicated'] },
      { name: 'onboarding',    type: 'string'  },
      { name: 'sla_hours',     type: 'integer'  },
    ]},
  { id: 'unit_economics',  name: 'Unit Economics',  description: 'CAC, LTV, marge et retour sur investissement unitaire',             icon: '📊', color: '#E81123', group: 'business',
    properties: [
      { name: 'cac',             type: 'string'  },
      { name: 'ltv',             type: 'string'  },
      { name: 'margin',          type: 'decimal' },
      { name: 'payback_months',  type: 'integer' },
    ]},
];

export const RELATIONSHIPS = [
  { id: 'constrains',  name: 'constrains',  from: 'architecture',   to: 'stack',          cardinality: 'one-to-many', description: "L'architecture contraint le choix de la stack" },
  { id: 'determines',  name: 'determines',  from: 'stack',          to: 'data_layer',     cardinality: 'one-to-one',  description: 'La stack détermine le data layer' },
  { id: 'secures',     name: 'secures',     from: 'security',       to: 'data_layer',     cardinality: 'many-to-one', description: 'La sécurité sécurise le data layer' },
  { id: 'consumes',    name: 'consumes',    from: 'ia_ml',          to: 'data_layer',     cardinality: 'many-to-many', description: "L'IA consomme les données du data layer" },
  { id: 'exposes',     name: 'exposes',     from: 'api_surface',    to: 'stack',          cardinality: 'one-to-one',  description: "L'API surface expose la stack" },
  { id: 'impacts',     name: 'impacts',     from: 'scale_perf',     to: 'architecture',   cardinality: 'many-to-many', description: 'Les besoins de scale impactent l\'architecture' },
  { id: 'governs',     name: 'governs',     from: 'security',       to: 'compliance',     cardinality: 'many-to-many', description: 'La sécurité gouverne la conformité' },
  { id: 'monetizes',   name: 'monetizes',   from: 'business_model', to: 'pricing',        cardinality: 'one-to-many', description: 'Le business model monétise via le pricing' },
  { id: 'distributes', name: 'distributes', from: 'go_to_market',   to: 'pricing',        cardinality: 'many-to-many', description: 'Le GTM distribue selon le pricing' },
  { id: 'targets',     name: 'targets',     from: 'go_to_market',   to: 'icp',            cardinality: 'many-to-one', description: 'Le GTM cible l\'ICP' },
  { id: 'drives',      name: 'drives',      from: 'revenue_model',  to: 'unit_economics', cardinality: 'one-to-one',  description: 'Le revenue model pilote l\'unit economics' },
  { id: 'retains',     name: 'retains',     from: 'customer_success', to: 'revenue_model', cardinality: 'many-to-one', description: 'Le customer success fidélise le revenue' },
  { id: 'funds',       name: 'funds',       from: 'revenue_model',  to: 'business_model', cardinality: 'many-to-one', description: 'Le revenue finance le business model' },
];

export const ENTITY_MAP = Object.fromEntries(ENTITY_TYPES.map((e) => [e.id, e]));

export function getEntity(id) { return ENTITY_MAP[id]; }
