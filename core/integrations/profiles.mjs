// KayrosLab — profils d'exécution d'une mission : demo / fast / deep.
//
//  demo : réponses préparées par rôle, instantanées, sans appel LLM ni coût.
//         Toujours étiquetées « démo » : sert à tester le câblage
//         Salesforce ↔ n8n ↔ KayrosLab, jamais à décider.
//  fast : modèle NVIDIA rapide (NVIDIA_FAST_MODEL), réponses plus courtes ;
//         verdict réel en 1 à 2 minutes. Profil par défaut des intégrations.
//  deep : configuration LLM du serveur (aujourd'hui Kimi K3), ~12 minutes.

export const EXECUTION_PROFILES = Object.freeze(['demo', 'fast', 'deep']);
export const DEFAULT_PROFILE = 'fast';
export const DEMO_PROVIDER_ID = 'demo';
export const FAST_PROVIDER_ID = 'nvidia-fast';

export function normalizeProfile(value, fallback = DEFAULT_PROFILE) {
  const profile = String(value || '').trim().toLowerCase();
  return EXECUTION_PROFILES.includes(profile) ? profile : fallback;
}

/**
 * Options d'exécution du swarm pour un profil. `fastAvailable` : le provider
 * rapide est enregistré (clé NVIDIA présente) ; sinon `fast` retombe sur la
 * configuration du serveur, et c'est signalé (`effective_profile`).
 */
export function profileRunOptions(profile, { fastAvailable = false, fastModel = null, deepModel = null, deepProvider = null } = {}) {
  const requested = normalizeProfile(profile);
  if (requested === 'demo') {
    return { requested, effective_profile: 'demo', provider: DEMO_PROVIDER_ID, model: null, eta_seconds: 5, simulated: true };
  }
  if (requested === 'fast' && fastAvailable) {
    return { requested, effective_profile: 'fast', provider: FAST_PROVIDER_ID, model: fastModel, eta_seconds: 90, simulated: false };
  }
  return {
    requested, effective_profile: 'deep', provider: undefined, model: undefined,
    eta_seconds: deepProvider === 'nvidia' && /kimi/i.test(String(deepModel || '')) ? 720 : 240,
    simulated: false,
    ...(requested === 'fast' ? { note: 'profil fast indisponible (NVIDIA_API_KEY absente) : configuration du serveur utilisée' } : {}),
  };
}

// --- Provider « démo » ------------------------------------------------------

const DEMO_LIBRARY = [
  {
    match: /cfo|financ|daf|finance/i,
    verdict: 'CONDITIONAL_GO',
    primary_reason: '[Démo] Rentabilité acceptable si la remise reste plafonnée et que l’échéancier de paiement est sécurisé.',
    strengths_opportunities: ['Chiffre d’affaires signé avant la clôture trimestrielle', 'Client référence dans son secteur'],
    critical_risks: ['Marge sous la cible si la remise dépasse 12 %', 'Délai de paiement à 90 jours qui pèse sur la trésorerie'],
    required_mitigations: ['Plafonner la remise à 12 %', 'Exiger un acompte de 30 % à la signature'],
  },
  {
    match: /cto|tech|dsi|it\b|engineer/i,
    verdict: 'GO',
    primary_reason: '[Démo] Le périmètre est couvert par la plateforme actuelle ; intégration estimée à 3 semaines.',
    strengths_opportunities: ['Réutilisation des connecteurs existants', 'Cas d’usage démontrable rapidement'],
    critical_risks: ['Dépendance à l’API du SI client non documentée'],
    required_mitigations: ['Atelier technique avant signature pour valider l’accès API'],
  },
  {
    match: /legal|jurid|counsel|avocat|compliance/i,
    verdict: 'CONDITIONAL_GO',
    primary_reason: '[Démo] Signature possible sous réserve de clauses de responsabilité et de données conformes au RGPD.',
    strengths_opportunities: ['Modèle de contrat standard applicable'],
    critical_risks: ['Clause de pénalités de retard non plafonnée', 'Transfert de données hors UE à clarifier'],
    required_mitigations: ['Plafonner les pénalités à 10 % du contrat', 'Annexer un DPA signé'],
  },
  {
    match: /sales|commercial|vente|cro|account/i,
    verdict: 'GO',
    primary_reason: '[Démo] Opportunité stratégique : forte probabilité de signature et potentiel d’extension.',
    strengths_opportunities: ['Sponsor exécutif identifié', 'Potentiel d’extension à d’autres entités'],
    critical_risks: ['Concurrent agressif sur le prix'],
    required_mitigations: ['Valoriser le ROI plutôt que concéder sur le prix'],
  },
  {
    match: /rh|hr|drh|people|talent/i,
    verdict: 'CONDITIONAL_GO',
    primary_reason: '[Démo] Faisable si l’équipe projet est staffée sans surcharger l’équipe existante.',
    strengths_opportunities: ['Montée en compétence de l’équipe'],
    critical_risks: ['Charge de l’équipe déjà à 110 %'],
    required_mitigations: ['Valider le staffing avant de s’engager sur la date'],
  },
];
const DEMO_DEFAULT = {
  verdict: 'CONDITIONAL_GO',
  primary_reason: '[Démo] Avis favorable sous conditions : les hypothèses clés restent à confirmer.',
  strengths_opportunities: ['Alignement avec la stratégie annoncée'],
  critical_risks: ['Hypothèses de volume non vérifiées'],
  required_mitigations: ['Confirmer les volumes avec le client'],
};

/**
 * Provider sans réseau : renvoie un avis JSON préparé selon le rôle de l'agent
 * (lu dans le prompt système). Le contenu est explicitement marqué « [Démo] ».
 */
export class DemoProvider {
  constructor({ delayMs = 150 } = {}) { this.id = DEMO_PROVIDER_ID; this.delayMs = delayMs; }
  async complete(req) {
    const system = (req.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const role = /You are ([^,\n]+)/.exec(system)?.[1] || req.role || '';
    const entry = DEMO_LIBRARY.find((item) => item.match.test(role)) || DEMO_DEFAULT;
    const { match, ...answer } = entry;
    const text = JSON.stringify({
      ...answer,
      simulated_stakeholder_feedback: '[Démo] Simulation : contenu préparé, aucune analyse réelle.',
      metrics: [{ metric: 'Profil d’exécution', value: 'démo (réponse préparée)', confidence_impact: 'low', persona_skepticism_level: 'low' }],
      unverified_assumptions: [],
    });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return { text, provider: this.id, model: 'kayros-demo', latencyMs: this.delayMs, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
  }
}
