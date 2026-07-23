export const ENTITY_TYPES = [
  { id: 'architecture',    name: 'Architecture',    description: 'The architectural pattern and technical structure',     icon: '🏗️', color: '#D83B01', group: 'tech',
    properties: [
      { name: 'pattern', type: 'enum',     values: ['monolith','modular','microservices','event-driven'], isIdentifier: true },
      { name: 'coupling',   type: 'string'  },
      { name: 'scalability', type: 'string'  },
    ]},
  { id: 'stack',           name: 'Stack',           description: 'Languages, frameworks, databases and infrastructure',          icon: '🛠️', color: '#0078D4', group: 'tech',
    properties: [
      { name: 'languages',  type: 'string'  },
      { name: 'frameworks', type: 'string'  },
      { name: 'database',   type: 'string'  },
      { name: 'cloud',      type: 'string'  },
      { name: 'ci_cd',      type: 'string'  },
    ]},
  { id: 'data_layer',      name: 'Data Layer',      description: 'Storage, pipeline, vector store and data management',          icon: '💾', color: '#107C10', group: 'tech',
    properties: [
      { name: 'storage_type', type: 'enum', values: ['relational','nosql','graph','vector'] },
      { name: 'pipeline',     type: 'string'  },
      { name: 'caching',      type: 'string'  },
      { name: 'vector_store', type: 'boolean' },
    ]},
  { id: 'security',        name: 'Security',        description: 'Encryption, authentication, compliance and governance',         icon: '🔒', color: '#5C2D91', group: 'tech',
    properties: [
      { name: 'encryption', type: 'enum', values: ['none','transit','rest','both'] },
      { name: 'auth',       type: 'string'  },
      { name: 'compliance', type: 'string'  },
      { name: 'hds',        type: 'boolean' },
      { name: 'nis2',       type: 'boolean' },
    ]},
  { id: 'ia_ml',           name: 'IA / ML',         description: 'Models, RAG, fine-tuning and inference capability',               icon: '🤖', color: '#00A9E0', group: 'tech',
    properties: [
      { name: 'models',      type: 'string'  },
      { name: 'rag',         type: 'boolean' },
      { name: 'fine_tuning', type: 'boolean' },
      { name: 'training',    type: 'string'  },
      { name: 'inference',   type: 'string'  },
    ]},
  { id: 'scale_perf',      name: 'Scale & Perf',    description: 'Throughput, latency, concurrency and scalability',              icon: '⚡', color: '#FFB900', group: 'tech',
    properties: [
      { name: 'throughput',  type: 'string'  },
      { name: 'latency_ms',  type: 'integer' },
      { name: 'concurrency', type: 'string'  },
      { name: 'sla',         type: 'decimal' },
    ]},
  { id: 'api_surface',     name: 'API Surface',     description: 'Protocols, endpoints, SDK and integration capability',             icon: '🔌', color: '#008272', group: 'tech',
    properties: [
      { name: 'protocols',  type: 'enum', values: ['rest','graphql','grpc','websocket'] },
      { name: 'versioning', type: 'string'  },
      { name: 'sdk',        type: 'boolean' },
      { name: 'openapi',    type: 'boolean' },
    ]},
  { id: 'business_model',  name: 'Business Model',  description: 'Economic model and go-to-market strategy',        icon: '💼', color: '#0078D4', group: 'business',
    properties: [
      { name: 'type',     type: 'enum', values: ['saas','paas','iaas','marketplace','hybrid'] },
      { name: 'maturity', type: 'enum', values: ['seed','early','growth','mature'] },
    ]},
  { id: 'pricing',         name: 'Pricing',          description: 'Pricing strategy and price structure',                    icon: '💰', color: '#107C10', group: 'business',
    properties: [
      { name: 'model',       type: 'enum', values: ['subscription','usage','tiered','flat','freemium'] },
      { name: 'entry_price', type: 'decimal'  },
      { name: 'per_seat',    type: 'boolean'  },
      { name: 'trial_days',  type: 'integer'  },
    ]},
  { id: 'go_to_market',    name: 'Go-to-Market',    description: 'Distribution channels and sales model',                         icon: '🚀', color: '#D83B01', group: 'business',
    properties: [
      { name: 'channel',      type: 'enum', values: ['direct','partner','marketplace','hybrid'] },
      { name: 'sales_model',  type: 'enum', values: ['self','inside','field'] },
      { name: 'geography',    type: 'string'  },
    ]},
  { id: 'icp',             name: 'ICP',              description: 'Target customer segment and persona',                            icon: '👤', color: '#5C2D91', group: 'business',
    properties: [
      { name: 'segment',       type: 'enum', values: ['smb','mid','enterprise','all'] },
      { name: 'persona',       type: 'string'  },
      { name: 'vertical',      type: 'string'  },
      { name: 'employees_min', type: 'integer'  },
    ]},
  { id: 'revenue_model',   name: 'Revenue',          description: 'Revenue structure and monetisation streams',                     icon: '📈', color: '#008272', group: 'business',
    properties: [
      { name: 'subscription',  type: 'boolean' },
      { name: 'transactional', type: 'boolean' },
      { name: 'marketplace',   type: 'boolean' },
      { name: 'arr_estimate',  type: 'string'  },
    ]},
  { id: 'customer_success', name: 'Customer Success', description: 'Support, onboarding, community and retention',                    icon: '🤝', color: '#00A9E0', group: 'business',
    properties: [
      { name: 'support_tier',  type: 'enum', values: ['self','chat','email','phone','dedicated'] },
      { name: 'onboarding',    type: 'string'  },
      { name: 'sla_hours',     type: 'integer'  },
    ]},
  { id: 'unit_economics',  name: 'Unit Economics',  description: 'CAC, LTV, margin and unit ROI',             icon: '📊', color: '#E81123', group: 'business',
    properties: [
      { name: 'cac',             type: 'string'  },
      { name: 'ltv',             type: 'string'  },
      { name: 'margin',          type: 'decimal' },
      { name: 'payback_months',  type: 'integer' },
    ]},
];

export const RELATIONSHIPS = [
  { id: 'constrains',  name: 'constrains',  from: 'architecture',   to: 'stack',          cardinality: 'one-to-many', description: 'Architecture constrains stack choice' },
  { id: 'determines',  name: 'determines',  from: 'stack',          to: 'data_layer',     cardinality: 'one-to-one',  description: 'Stack determines data layer' },
  { id: 'secures',     name: 'secures',     from: 'security',       to: 'data_layer',     cardinality: 'many-to-one', description: 'Security secures data layer' },
  { id: 'consumes',    name: 'consumes',    from: 'ia_ml',          to: 'data_layer',     cardinality: 'many-to-many', description: 'IA consumes data layer' },
  { id: 'exposes',     name: 'exposes',     from: 'api_surface',    to: 'stack',          cardinality: 'one-to-one',  description: 'API surface exposes stack' },
  { id: 'impacts',     name: 'impacts',     from: 'scale_perf',     to: 'architecture',   cardinality: 'many-to-many', description: 'Scale requirements impact architecture' },
  { id: 'governs',     name: 'governs',     from: 'security',       to: 'compliance',     cardinality: 'many-to-many', description: 'Security governs compliance' },
  { id: 'monetizes',   name: 'monetizes',   from: 'business_model', to: 'pricing',        cardinality: 'one-to-many', description: 'Business model monetises via pricing' },
  { id: 'distributes', name: 'distributes', from: 'go_to_market',   to: 'pricing',        cardinality: 'many-to-many', description: 'GTM distributes per pricing' },
  { id: 'targets',     name: 'targets',     from: 'go_to_market',   to: 'icp',            cardinality: 'many-to-one', description: 'GTM targets ICP' },
  { id: 'drives',      name: 'drives',      from: 'revenue_model',  to: 'unit_economics', cardinality: 'one-to-one',  description: 'Revenue model drives unit economics' },
  { id: 'retains',     name: 'retains',     from: 'customer_success', to: 'revenue_model', cardinality: 'many-to-one', description: 'Customer success retains revenue' },
  { id: 'funds',       name: 'funds',       from: 'revenue_model',  to: 'business_model', cardinality: 'many-to-one', description: 'Revenue funds business model' },
];

export const ENTITY_MAP = Object.fromEntries(ENTITY_TYPES.map((e) => [e.id, e]));

export function getEntity(id) { return ENTITY_MAP[id]; }

export const TECH_ENTITY_IDS = ENTITY_TYPES.filter((e) => e.group === 'tech').map((e) => e.id);
export const BUSINESS_ENTITY_IDS = ENTITY_TYPES.filter((e) => e.group === 'business').map((e) => e.id);
export const ALL_ENTITY_IDS = ENTITY_TYPES.map((e) => e.id);
