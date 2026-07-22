export const NEURONS = {
  tech: [
    {
      id: 'architecture',
      label: 'Architecture',
      color: '#6366f1',
      bg: '#eef2ff',
      description: 'Monolith, microservices, modular, P2P, event-driven',
      keywords: ['microservices', 'monolith', 'architecture', 'modular', 'p2p', 'event-driven', 'distributed'],
    },
    {
      id: 'stack',
      label: 'Stack',
      color: '#8b5cf6',
      bg: '#f5f3ff',
      description: 'Langages, frameworks, DB, infrastructure, LLM provider',
      keywords: ['language', 'framework', 'database', 'infrastructure', 'stack', 'tech stack', 'runtime'],
    },
    {
      id: 'data',
      label: 'Data Layer',
      color: '#06b6d4',
      bg: '#ecfeff',
      description: 'Stockage, pipeline, vector store, entraînement',
      keywords: ['vector store', 'data pipeline', 'training data', 'database', 'embedding', 'data storage'],
    },
    {
      id: 'security',
      label: 'Securité',
      color: '#10b981',
      bg: '#ecfdf5',
      description: 'Chiffrement, auth, HDS, NIS2, conformité',
      keywords: ['encryption', 'authentication', 'security', 'hds', 'nis2', 'rgpd', 'soc2', 'compliance', 'audit'],
    },
    {
      id: 'iaMl',
      label: 'IA / ML',
      color: '#f59e0b',
      bg: '#fffbeb',
      description: 'Modèles, RAG, fine-tuning, inférence',
      keywords: ['machine learning', 'deep learning', 'llm', 'rag', 'fine-tuning', 'inference', 'neural', 'ai'],
    },
    {
      id: 'scale',
      label: 'Scale & Perf',
      color: '#f97316',
      bg: '#fff7ed',
      description: 'Throughput, latence, concurrence, montée en charge',
      keywords: ['performance', 'scalability', 'throughput', 'latency', 'concurrency', 'high-availability'],
    },
    {
      id: 'api',
      label: 'API Surface',
      color: '#ef4444',
      bg: '#fef2f2',
      description: 'Endpoints, intégration, webhooks, embeddability',
      keywords: ['api', 'webhook', 'rest', 'graphql', 'sdk', 'integration', 'embeddable'],
    },
  ],
  business: [
    {
      id: 'businessModel',
      label: 'Business Model',
      color: '#ec4899',
      bg: '#fdf2f8',
      description: 'SaaS, license, open core, freemium',
      keywords: ['saas', 'license', 'open core', 'freemium', 'subscription', 'open source', 'marketplace'],
    },
    {
      id: 'pricing',
      label: 'Pricing',
      color: '#f43f5e',
      bg: '#fff1f2',
      description: 'Per-seat, usage-based, tiered, flat',
      keywords: ['pricing', 'per-seat', 'usage-based', 'tiered', 'flat', 'per user', 'enterprise pricing'],
    },
    {
      id: 'gtm',
      label: 'Go-to-Market',
      color: '#e11d48',
      bg: '#ffe4e6',
      description: 'Direct, PLG, enterprise sales, partenaires',
      keywords: ['go-to-market', 'plg', 'enterprise sales', 'partner', 'channel', 'sales', 'growth'],
    },
    {
      id: 'icp',
      label: 'ICP',
      color: '#be185d',
      bg: '#fce7f3',
      description: 'Segment, persona, cas d\'usage cible',
      keywords: ['target', 'customer', 'persona', 'segment', 'b2b', 'b2c', 'enterprise', 'startup'],
    },
    {
      id: 'revenue',
      label: 'Revenue Model',
      color: '#d946ef',
      bg: '#fae8ff',
      description: 'Subscription, transactionnel, hybride',
      keywords: ['revenue', 'subscription', 'transactional', 'hybrid', 'monetization', 'recurring'],
    },
    {
      id: 'customerSuccess',
      label: 'Customer Success',
      color: '#0ea5e9',
      bg: '#f0f9ff',
      description: 'Support, onboarding, communauté, SLA',
      keywords: ['support', 'onboarding', 'community', 'sla', 'customer success', 'documentation', 'training'],
    },
    {
      id: 'unitEconomics',
      label: 'Unit Economics',
      color: '#14b8a6',
      bg: '#f0fdfa',
      description: 'CAC, LTV, marge brute, payback',
      keywords: ['cac', 'ltv', 'gross margin', 'payback', 'unit economics', 'burn rate', 'efficiency'],
    },
  ],
};

export const NEURON_LIST = [...NEURONS.tech, ...NEURONS.business];

export function getNeuron(id) {
  return NEURON_LIST.find((n) => n.id === id);
}
