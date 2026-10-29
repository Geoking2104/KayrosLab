# Pilote Proof-of-Control : journal d'audit chaîné, signé et vérifiable

> Statut : pilote. KayrosLab **ne revendique pas** la conformité Proof-of-Control.
> Le standard ([advancedaisociety.org/proof-of-control](https://advancedaisociety.org/proof-of-control),
> dépôt `AAI-Society/ov-poc-standard`) est un brouillon v1.0 en commentaires publics.

## Ce que fait le pilote

`core/evidence-chain.mjs` enveloppe n'importe quel sink d'audit existant (`createMemorySink`, `createJsonlSink`, fonction). Chaque événement devient une enveloppe `kayros-evidence/0.1` :

| Champ | Rôle |
|---|---|
| `chain`, `seq` | une chaîne par `runId`, numérotée depuis 0 |
| `prev` | empreinte de l'enveloppe précédente (`0…0` pour la première) |
| `payload`, `payload_digest` | l'événement d'origine et son SHA-256 en JSON canonique |
| `ts`, `alg`, `kid` | horodatage de scellement, `Ed25519`, empreinte de la clé publique |
| `hash` | SHA-256 du JSON canonique de l'enveloppe sans `hash` ni `sig` |
| `sig` | signature Ed25519 de `hash` (base64url) |

`checkpoint(runId)` produit une tête de chaîne signée. Publiée hors du système (dépôt, horodatage, e-mail à un tiers), elle permet de détecter une **troncature** de la fin du journal. `onCheckpoint` + `checkpointEvery` l'automatisent.

## Activation

```js
import { createEngine, createJsonlSink } from './core/index.mjs';
const engine = createEngine({
  auditSink: createJsonlSink({ dir: 'logs' }),
  auditSigningKey: process.env.KAYROS_AUDIT_SIGNING_KEY, // PEM PKCS#8 Ed25519
});
// essaim et passerelle hybride : scellés automatiquement
// orchestrateur : passer engine.auditEvidence comme logSink
```

Sans `auditSigningKey`, le comportement est inchangé.

## Vérification par un tiers

```bash
node scripts/verify-audit-chain.mjs --keygen ./keys          # paire Ed25519 (garder la clé privée secrète)
node scripts/verify-audit-chain.mjs logs/<runId>.jsonl --pubkey keys/audit-signing.pub.pem [--checkpoint cp.json]
```

Résultat binaire (code 0 / 1) et première rupture : contenu modifié, signature invalide, clé inconnue, séquence ou chaînage rompu, journal tronqué.

## Correspondance avec le brouillon (indicative)

| Propriété PoC (C7) | Pilote |
|---|---|
| Contemporaine | scellée à l'append, pas reconstruite après coup |
| Infalsifiable de façon détectable | chaîne SHA-256 + Ed25519 |
| Binaire | vérification ok / échec |
| Transparente sur la confiance résiduelle | voir ci-dessous |

## Confiance résiduelle et limites

- Le détenteur de la clé privée (l'opérateur) peut réécrire **toute** une chaîne non encore ancrée : seul un checkpoint publié à l'extérieur l'en empêche. Sans ancrage, on reste proche du niveau 2.
- Complétude non garantie : seuls les événements passés par le sink sont prouvés ; pas de passerelle d'interception sans contournement (C7.1).
- Pas de gestion de rotation ni de révocation de clés, pas de stockage HSM/KMS.
- Format maison proche de RFC 8785, pas le profil CWT/CBOR ni les vecteurs `poc-evidence-vectors`.
- Les payloads sont en clair : la minimisation des données (C2) reste à faire.
