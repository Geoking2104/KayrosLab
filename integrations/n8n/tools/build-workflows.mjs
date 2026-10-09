// Génère les workflows n8n importables (../workflows/*.json) à partir de ce
// fichier : le code des nœuds « Code » reste lisible et testé
// (tests/n8n-workflows.test.mjs). Après modification :
//   node integrations/n8n/tools/build-workflows.mjs
import { writeFileSync } from 'node:fs';

const EVENTS_PATH = 'kayros-mission-events';
// Identifiants fixes : un ré-import remplace le workflow au lieu de le dupliquer.
const IDS = {
  launch: 'KayrosSfLaunch01',
  events: 'KayrosSfEvents01',
  webhook: '6b0f5b8e-2c1d-4c55-9a43-8a1f3c2e7d10',
};

export const CONFIG_CODE = String.raw`// ⚙️ CONFIGURATION — à adapter (seul nœud à modifier pour le PoC)
const CONFIG = {
  // API KayrosLab (https://api.kayroslab.com/docs)
  kayros_api: 'https://api.kayroslab.com',
  // Collectif qui instruit la revue : GET /v1/public/collectives, champ "id"
  collective_id: 'room_REMPLACER',
  // Étape Salesforce qui déclenche la revue (valeur exacte du champ StageName)
  stage: 'Proposal/Price Quote',
  // demo (< 5 s, simulé) · fast (défaut, 1–2 min) · deep (~12 min)
  profile: 'fast',
  // URL de production du workflow « KayrosLab → Salesforce : verdict et arbitrage »
  events_url: 'https://n8n.kayroslab.com/webhook/${EVENTS_PATH}',
};

// Une seule revue par opportunité et par étape, même si l'opportunité est
// modifiée plusieurs fois (montant, date…) pendant l'étape.
const state = $getWorkflowStaticData('global');
state.launched = state.launched || {};

const out = [];
for (const item of $input.all()) {
  const opp = item.json;
  if (!opp.Id || opp.StageName !== CONFIG.stage) continue;
  const idempotencyKey = ('sf-' + opp.Id + '-' + opp.StageName).replace(/\s+/g, '_').slice(0, 200);
  if (state.launched[idempotencyKey]) continue;
  const amount = opp.Amount != null ? opp.Amount + (opp.CurrencyIsoCode ? ' ' + opp.CurrencyIsoCode : '') : 'montant non renseigné';
  out.push({ json: {
    ...CONFIG,
    opportunity_id: opp.Id,
    opportunity_name: opp.Name || opp.Id,
    idempotency_key: idempotencyKey,
    question: 'Faut-il engager l’opportunité « ' + (opp.Name || opp.Id) + ' » (' + amount + ', clôture ' + (opp.CloseDate || 'non fixée') + ') à l’étape ' + opp.StageName + ' ? Donnez un verdict GO / CONDITIONAL_GO / NO_GO, les risques et les conditions.',
    context: String(opp.Description || '').slice(0, 20000),
    metadata: {
      opportunity: opp.Name || null, stage: opp.StageName, amount: opp.Amount ?? null,
      close_date: opp.CloseDate || null, probability: opp.Probability ?? null,
      type: opp.Type || null, lead_source: opp.LeadSource || null, account_id: opp.AccountId || null,
    },
  } });
}
return out;
`;

export const LAUNCH_RESULT_CODE = String.raw`// 202 = mission lancée · 200 = déjà lancée (rejeu idempotent) · 409 = clé déjà
// utilisée avec une autre requête (opportunité modifiée entre-temps) : dans ces
// trois cas l'opportunité est marquée comme traitée pour cette étape.
const state = $getWorkflowStaticData('global');
state.launched = state.launched || {};
const out = [];
$input.all().forEach((item, index) => {
  const request = $('Configuration et filtre').itemMatching(index).json;
  const status = Number(item.json.statusCode);
  const body = item.json.body || {};
  if ([200, 202, 409].includes(status)) {
    state.launched[request.idempotency_key] = new Date().toISOString();
    out.push({ json: {
      opportunity_id: request.opportunity_id, opportunity_name: request.opportunity_name,
      outcome: status === 202 ? 'mission lancée' : status === 200 ? 'déjà lancée' : 'déjà traitée (409)',
      mission_id: body.mission_id || null, eta_seconds: body.eta_seconds ?? null,
      dossier_url: body.dossier_url || null, note: body.note || null,
    } });
    return;
  }
  throw new Error('KayrosLab a refusé la mission (' + status + ') : ' + (body.error || JSON.stringify(body)).slice(0, 500));
});
return out;
`;

export const PREPARE_CODE = String.raw`// Extrait l'horodatage et la signature de X-Kayros-Signature, et reconstruit
// la chaîne signée : t + "." + corps. KayrosLab signe JSON.stringify(événement) ;
// n8n a déjà analysé le JSON, et JSON.stringify(JSON.parse(x)) === x pour tout
// JSON produit par JSON.stringify : la signature se vérifie à l'identique.
return $input.all().map((item) => {
  const headers = item.json.headers || {};
  const header = String(headers['x-kayros-signature'] || '');
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = (parts.find(([key]) => key === 't') || [])[1] || '';
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value || '');
  const body = item.json.body || {};
  return { json: { signature_t: timestamp, signatures, signed_payload: timestamp + '.' + JSON.stringify(body), event: body } };
});
`;

export const VERIFY_CODE = String.raw`// ⚙️ Options
const OPTIONS = {
  // false = ignorer les arbitrages humains (mission.arbitrated)
  notify_arbitration: true,
  // Écart toléré entre l'horodatage signé et l'horloge de n8n (secondes)
  tolerance_seconds: 300,
};

// 1) Signature : HMAC-SHA256(secret, t + "." + corps) calculé par le nœud précédent.
const state = $getWorkflowStaticData('global');
state.seen = state.seen || {};
const now = Date.now();
for (const [id, at] of Object.entries(state.seen)) if (now - at > 7 * 24 * 3600 * 1000) delete state.seen[id];

const out = [];
for (const item of $input.all()) {
  const { signature_t: t, signatures = [], expected_signature: expected, event = {} } = item.json;
  if (!t || !signatures.length) throw new Error('Signature KayrosLab absente : requête refusée.');
  if (!signatures.includes(expected)) throw new Error('Signature KayrosLab invalide : vérifiez le secret (console → Intégrations → Webhook).');
  if (Math.abs(now / 1000 - Number(t)) > OPTIONS.tolerance_seconds) throw new Error('Horodatage de signature hors tolérance (rejeu ?).');

  // 2) Filtrage : test de la console, doublons (nouvel essai après coupure), objets non Salesforce.
  if (event.event === 'ping') { out.push({ json: { skipped: 'ping', message: 'Signature valide : le webhook est correctement configuré.' } }); continue; }
  if (state.seen[event.event_id]) { out.push({ json: { skipped: 'doublon', event_id: event.event_id } }); continue; }
  state.seen[event.event_id] = now;
  const ref = event.external_ref || {};
  if (String(ref.system || '').toLowerCase() !== 'salesforce' || !ref.id) { out.push({ json: { skipped: 'objet non Salesforce', mission_id: event.mission_id } }); continue; }
  if (event.event === 'mission.arbitrated' && !OPTIONS.notify_arbitration) { out.push({ json: { skipped: 'arbitrage ignoré', mission_id: event.mission_id } }); continue; }

  // 3) Tâche Salesforce lisible par un commercial.
  const demo = event.llm && event.llm.simulated ? '[Démo] ' : '';
  const label = event.verdict_label || (event.verdict ? String(event.verdict).replace(/_/g, ' ') : 'sans verdict');
  const list = (title, items) => (items && items.length ? [title, ...items.map((entry) => '- ' + entry)] : []);
  // Score d'adhésion (0–100) : GO = 1, CONDITIONAL_GO = 0,5, autre = 0, moyenne des agents.
  const weights = { GO: 1, CONDITIONAL_GO: 0.5 };
  const votes = (event.agents || []).filter((agent) => agent.verdict);
  const score = votes.length ? Math.round((100 * votes.reduce((sum, agent) => sum + (weights[agent.verdict] || 0), 0)) / votes.length) : null;
  let subject; let priority = 'Normal'; const lines = [];
  if (event.event === 'mission.failed') {
    subject = demo + 'KayrosLab — Revue en échec';
    priority = 'High';
    lines.push('La revue du collectif n’a pas abouti : ' + (event.error || 'erreur inconnue') + '.', 'Relancez-la depuis la console ou en repassant l’opportunité à l’étape.');
  } else if (event.event === 'mission.arbitrated') {
    const decision = event.human_decision || {};
    const verdict = decision.verdict ? String(decision.verdict).replace(/_/g, ' ') : label;
    subject = demo + 'KayrosLab — Décision : ' + verdict;
    lines.push('Décision humaine : ' + verdict + (decision.by ? ' (par ' + decision.by + ')' : ''));
    if (decision.justification) lines.push('Justification : ' + decision.justification);
    lines.push('Avis du collectif : ' + label);
  } else {
    subject = demo + 'KayrosLab — Verdict : ' + label;
    if (event.verdict === 'NO_GO') priority = 'High';
    lines.push('Verdict du collectif : ' + label);
    if (score !== null) lines.push('Score d’adhésion : ' + score + '/100 (' + votes.length + ' agents)');
    if (event.summary) lines.push('Synthèse : ' + event.summary);
    lines.push('', ...list('Risques :', event.risks), ...list('Conditions :', event.conditions));
    const agents = (event.agents || []).map((agent) => agent.name + ' : ' + String(agent.verdict || '—').replace(/_/g, ' ') + (agent.reason ? ' — ' + agent.reason : ''));
    lines.push('', ...list('Avis des agents :', agents));
    if (event.clarification_questions && event.clarification_questions.length) lines.push('', ...list('Questions de clarification :', event.clarification_questions.map((q) => (typeof q === 'string' ? q : q.question || JSON.stringify(q)))));
  }
  if (demo) lines.push('', '⚠️ Mode démo : réponses préenregistrées, ne pas utiliser pour décider.');
  lines.push('', 'Dossier complet et arbitrage : ' + (event.dossier_url || '—'));
  lines.push('Mission ' + event.mission_id + ' · profil ' + (event.profile || '—') + (event.llm && event.llm.provider ? ' · ' + event.llm.provider : ''));

  out.push({ json: {
    opportunity_id: ref.id,
    task_subject: subject.slice(0, 255),
    task_description: lines.join('\n').slice(0, 31000),
    task_priority: priority,
    task_date: new Date().toISOString().slice(0, 10),
    event: event.event, mission_id: event.mission_id, verdict: event.verdict || null,
    verdict_label: label, score, dossier_url: event.dossier_url || null,
    human_verdict: event.human_decision ? event.human_decision.verdict || null : null,
  } });
}
return out;
`;

const pos = (x, y) => [x, y];

export function launchWorkflow() {
  return {
    id: IDS.launch,
    name: 'KayrosLab — Salesforce : lancer la revue d’opportunité',
    nodes: [
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000001', name: 'Opportunité modifiée', type: 'n8n-nodes-base.salesforceTrigger', typeVersion: 1.1, position: pos(0, 0),
        parameters: { authentication: 'oAuth2', triggerOn: 'opportunityUpdated', pollTimes: { item: [{ mode: 'everyMinute' }] } },
      },
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000002', name: 'Opportunité créée', type: 'n8n-nodes-base.salesforceTrigger', typeVersion: 1.1, position: pos(0, 200),
        parameters: { authentication: 'oAuth2', triggerOn: 'opportunityCreated', pollTimes: { item: [{ mode: 'everyMinute' }] } },
      },
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000003', name: 'Lire l’opportunité', type: 'n8n-nodes-base.salesforce', typeVersion: 1.1, position: pos(240, 100),
        parameters: { authentication: 'oAuth2', resource: 'opportunity', operation: 'get', opportunityId: '={{ $json.Id }}' },
      },
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000004', name: 'Configuration et filtre', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(480, 100),
        parameters: { jsCode: CONFIG_CODE },
      },
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000005', name: 'Lancer la mission KayrosLab', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(720, 100),
        parameters: {
          method: 'POST',
          url: '={{ $json.kayros_api }}/v1/public/missions',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'Idempotency-Key', value: '={{ $json.idempotency_key }}' }] },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ collective_id: $json.collective_id, question: $json.question, context: $json.context || undefined, profile: $json.profile, external_ref: { system: "salesforce", object: "Opportunity", id: $json.opportunity_id }, metadata: $json.metadata, callback_url: $json.events_url, callback_events: ["mission.completed", "mission.failed", "mission.arbitrated"] }) }}',
          options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 30000 },
        },
      },
      {
        id: 'a1c7e0a2-0b1f-4a50-8a0e-000000000006', name: 'Résultat du lancement', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(960, 100),
        parameters: { jsCode: LAUNCH_RESULT_CODE },
      },
    ],
    connections: {
      'Opportunité modifiée': { main: [[{ node: 'Lire l’opportunité', type: 'main', index: 0 }]] },
      'Opportunité créée': { main: [[{ node: 'Lire l’opportunité', type: 'main', index: 0 }]] },
      'Lire l’opportunité': { main: [[{ node: 'Configuration et filtre', type: 'main', index: 0 }]] },
      'Configuration et filtre': { main: [[{ node: 'Lancer la mission KayrosLab', type: 'main', index: 0 }]] },
      'Lancer la mission KayrosLab': { main: [[{ node: 'Résultat du lancement', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveManualExecutions: true },
    pinData: {},
    active: false,
    meta: { templateCredsSetupCompleted: false },
  };
}

export function eventsWorkflow() {
  return {
    id: IDS.events,
    name: 'KayrosLab → Salesforce : verdict et arbitrage',
    nodes: [
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000001', name: 'Événement KayrosLab', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(0, 0),
        webhookId: IDS.webhook,
        // `lastNode` : KayrosLab ne reçoit 200 qu'une fois la tâche créée ; sinon il réessaie (1 min → 6 h).
        parameters: { httpMethod: 'POST', path: EVENTS_PATH, responseMode: 'lastNode', options: {} },
      },
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000002', name: 'Préparer la vérification', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(240, 0),
        parameters: { jsCode: PREPARE_CODE },
      },
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000003', name: 'Calculer la signature (HMAC)', type: 'n8n-nodes-base.crypto', typeVersion: 2, position: pos(480, 0),
        parameters: { action: 'hmac', type: 'SHA256', value: '={{ $json.signed_payload }}', dataPropertyName: 'expected_signature', encoding: 'hex' },
      },
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000004', name: 'Vérifier la signature', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(720, 0),
        parameters: { jsCode: VERIFY_CODE },
      },
      {
        // Les événements ignorés (test, doublon, objet non Salesforce) sortent par « faux » :
        // le webhook répond 200 et KayrosLab ne réessaie pas.
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000005', name: 'Tâche à créer ?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(960, 0),
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            conditions: [{ id: 'c0ffee00-0000-4000-8000-000000000001', leftValue: '={{ $json.opportunity_id }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
            combinator: 'and',
          },
          options: {},
        },
      },
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000008', name: 'Rien à créer', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: pos(1200, 200),
        parameters: {},
      },
      {
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000006', name: 'Créer la tâche Salesforce', type: 'n8n-nodes-base.salesforce', typeVersion: 1.1, position: pos(1200, 0),
        parameters: {
          authentication: 'oAuth2', resource: 'task', operation: 'create', status: 'Completed',
          additionalFields: {
            whatId: '={{ $json.opportunity_id }}', subject: '={{ $json.task_subject }}', description: '={{ $json.task_description }}',
            priority: '={{ $json.task_priority }}', activityDate: '={{ $json.task_date }}',
          },
        },
      },
      {
        // Option « champs personnalisés » (CUSTOM-FIELDS.md) : désactivé par défaut.
        id: 'b2d8f1b3-1c2a-4b61-9b1f-000000000007', name: 'Champs KayrosLab sur l’opportunité (option)', type: 'n8n-nodes-base.salesforce', typeVersion: 1.1, position: pos(1440, 0),
        disabled: true,
        parameters: {
          authentication: 'oAuth2', resource: 'opportunity', operation: 'update',
          opportunityId: "={{ $('Tâche à créer ?').item.json.opportunity_id }}",
          updateFields: {
            customFieldsUi: { customFieldsValues: [
              { fieldId: 'Kayros_Verdict__c', value: "={{ $('Tâche à créer ?').item.json.human_verdict || $('Tâche à créer ?').item.json.verdict }}" },
              { fieldId: 'Kayros_Score__c', value: "={{ $('Tâche à créer ?').item.json.score }}" },
              { fieldId: 'Kayros_Dossier__c', value: "={{ $('Tâche à créer ?').item.json.dossier_url }}" },
              { fieldId: 'Kayros_Statut__c', value: "={{ $('Tâche à créer ?').item.json.event === 'mission.arbitrated' ? 'Arbitré' : $('Tâche à créer ?').item.json.event === 'mission.failed' ? 'Échec' : 'À arbitrer' }}" },
            ] },
          },
        },
      },
    ],
    connections: {
      'Événement KayrosLab': { main: [[{ node: 'Préparer la vérification', type: 'main', index: 0 }]] },
      'Préparer la vérification': { main: [[{ node: 'Calculer la signature (HMAC)', type: 'main', index: 0 }]] },
      'Calculer la signature (HMAC)': { main: [[{ node: 'Vérifier la signature', type: 'main', index: 0 }]] },
      'Vérifier la signature': { main: [[{ node: 'Tâche à créer ?', type: 'main', index: 0 }]] },
      'Tâche à créer ?': { main: [[{ node: 'Créer la tâche Salesforce', type: 'main', index: 0 }], [{ node: 'Rien à créer', type: 'main', index: 0 }]] },
      'Créer la tâche Salesforce': { main: [[{ node: 'Champs KayrosLab sur l’opportunité (option)', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveManualExecutions: true },
    pinData: {},
    active: false,
    meta: { templateCredsSetupCompleted: false },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('../workflows/', import.meta.url);
  writeFileSync(new URL('salesforce-opportunity-review.json', dir), `${JSON.stringify(launchWorkflow(), null, 2)}\n`);
  writeFileSync(new URL('kayroslab-verdict-to-salesforce.json', dir), `${JSON.stringify(eventsWorkflow(), null, 2)}\n`);
  console.log('workflows n8n générés');
}
