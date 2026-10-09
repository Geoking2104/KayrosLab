# Salesforce × KayrosLab avec Zapier — 2 Zaps

Variante sans serveur du PoC n8n (`../n8n/README.md`), pour une équipe qui utilise déjà Zapier. Même API, même principe : une opportunité passe en **Proposal** → mission KayrosLab → **tâche « Verdict »** sur l'opportunité.

> Plan Zapier requis : **Professional** ou supérieur (Zaps multi-étapes, *Webhooks by Zapier* et *Code by Zapier* sont des applications premium).

Préparation, comme pour n8n : console → **Intégrations** → créez une clé d'API (`kl_live_…`) et révélez le secret de signature (`whsec_…`). Notez l'identifiant du collectif (`room_…`).

---

## Zap 2 — « KayrosLab → Salesforce » (à créer en premier : il fournit l'URL de retour)

**Déclencheur : Webhooks by Zapier → Catch Raw Hook.** Copiez l'URL fournie (`https://hooks.zapier.com/hooks/catch/…/…/`). *Raw* est indispensable : la signature porte sur le corps exact.

**Étape 2 : Code by Zapier → Run JavaScript.** *Input Data* :

| Clé | Valeur (champ du déclencheur) |
|-----|-------------------------------|
| `raw_body` | *Raw Body* |
| `signature` | l'en-tête *X-Kayros-Signature* (affiché « Headers Http X Kayros Signature ») |
| `secret` | collez `whsec_…` |

```javascript
const crypto = require('crypto');
const header = String(inputData.signature || '');
const parts = header.split(',').map((p) => p.trim().split('='));
const t = (parts.find(([k]) => k === 't') || [])[1];
const received = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
const expected = crypto.createHmac('sha256', inputData.secret).update(t + '.' + inputData.raw_body, 'utf8').digest('hex');
if (!t || !received.includes(expected)) throw new Error('Signature KayrosLab invalide');
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error('Horodatage hors tolérance');

const e = JSON.parse(inputData.raw_body);
const ref = e.external_ref || {};
const label = e.verdict_label || 'sans verdict';
const bullets = (title, list) => (list && list.length ? '\n' + title + '\n- ' + list.join('\n- ') : '');
const decision = e.human_decision ? String(e.human_decision.verdict || '').replace(/_/g, ' ') : '';
output = {
  event: e.event,
  opportunity_id: ref.system === 'salesforce' ? ref.id : '',
  subject: (e.llm && e.llm.simulated ? '[Démo] ' : '') + (e.event === 'mission.arbitrated' ? 'KayrosLab — Décision : ' + decision
    : e.event === 'mission.failed' ? 'KayrosLab — Revue en échec' : 'KayrosLab — Verdict : ' + label),
  description: ('Verdict du collectif : ' + label + (e.summary ? '\nSynthèse : ' + e.summary : '')
    + bullets('Risques :', e.risks) + bullets('Conditions :', e.conditions)
    + '\n\nDossier complet et arbitrage : ' + (e.dossier_url || '—')).slice(0, 31000),
  priority: e.verdict === 'NO_GO' || e.event === 'mission.failed' ? 'High' : 'Normal',
};
```

**Étape 3 : Filter by Zapier** : *opportunity_id* → *Exists* (ignore le test « ping » de la console).

**Étape 4 : Salesforce → Create Record**, objet **Task** :

| Champ | Valeur |
|-------|--------|
| Related To ID (`WhatId`) | `opportunity_id` |
| Subject | `subject` |
| Comments (`Description`) | `description` |
| Status | `Completed` |
| Priority | `priority` |

Publiez le Zap.

## Zap 1 — « Salesforce → KayrosLab »

**Déclencheur : Salesforce → Updated Field on Record.** Objet *Opportunity*, champ *Stage* (`StageName`).

**Étape 2 : Filter by Zapier** : *Stage* → *(Text) Exactly matches* → `Proposal/Price Quote` (la valeur exacte dans votre org).

**Étape 3 : Webhooks by Zapier → Custom Request.**

| Champ | Valeur |
|-------|--------|
| Method | `POST` |
| URL | `https://api.kayroslab.com/v1/public/missions` |
| Headers | `Authorization` : `Bearer kl_live_…` · `Content-Type` : `application/json` · `Idempotency-Key` : `sf-{{Opportunity ID}}-{{Stage}}` |
| Data | le JSON ci-dessous |

```json
{
  "collective_id": "room_REMPLACER",
  "question": "Faut-il engager l'opportunité « {{Name}} » ({{Amount}}, clôture {{Close Date}}) à l'étape {{Stage}} ? Donnez un verdict GO / CONDITIONAL_GO / NO_GO, les risques et les conditions.",
  "profile": "fast",
  "external_ref": "salesforce:Opportunity:{{Opportunity ID}}",
  "metadata": { "opportunity": "{{Name}}", "stage": "{{Stage}}", "amount": "{{Amount}}" },
  "callback_url": "https://hooks.zapier.com/hooks/catch/…/…/"
}
```

(`{{…}}` : insérez les champs du déclencheur Salesforce ; `callback_url` = l'URL du Zap 2.) Pour une démonstration instantanée, `"profile": "demo"`.

Publiez le Zap, puis passez une opportunité à l'étape *Proposal/Price Quote* : la tâche « Verdict » apparaît après le délai de déclenchement Zapier (1 à 15 min selon le plan), plus 1 à 2 min d'analyse.

---

## Différences avec n8n

| | n8n (recommandé) | Zapier |
|-|------------------|--------|
| Hébergement | VPS KayrosLab, données en Europe | SaaS Zapier (États-Unis) |
| Coût | inclus (VPS existant) | abonnement Professional |
| Secret de signature | identifiant chiffré n8n | champ du pas Code (visible des éditeurs du Zap) |
| Doublons | mémoire du workflow + `event_id` | clé d'idempotence côté KayrosLab ; une tâche peut être dupliquée si Zapier rejoue un webhook |
| Arbitrage humain | tâche « Décision » | idem (même Zap 2, événement `mission.arbitrated`) |

Les champs personnalisés (Verdict, Score, Dossier) : voir `../n8n/CUSTOM-FIELDS.md`. Ajoutez une étape *Salesforce → Update Record (Opportunity)* au Zap 2.
