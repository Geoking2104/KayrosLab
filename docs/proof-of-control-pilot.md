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

## Activation côté backend (Fastify)

1. Générer la paire Ed25519 sur une machine de confiance :

   ```bash
   node scripts/verify-audit-chain.mjs --keygen ./keys
   # keys/audit-signing.key.pem (0600, secrète) · keys/audit-signing.pub.pem (à publier)
   # équivalent openssl : openssl genpkey -algorithm ed25519 -out audit-signing.key.pem
   ```

2. Fournir la clé au backend, une seule des deux formes :

   | Variable | Rôle |
   |---|---|
   | `KAYROS_AUDIT_SIGNING_KEY_FILE` | chemin du PEM (recommandé : secret monté en fichier) |
   | `KAYROS_AUDIT_SIGNING_KEY` | PEM en clair (`\n` échappés acceptés) ou PEM en base64 (`base64 -w0 key.pem`) |
   | `KAYROS_AUDIT_DIR` | journaux scellés, un fichier par chaîne (défaut `./data/audit`) |
   | `KAYROS_AUDIT_CHECKPOINT_EVERY` | checkpoint signé toutes les N entrées (défaut 100) |
   | `KAYROS_AUDIT_ANCHOR_DIR` | dossier d'ancrage, à monter sur un stockage distinct |
   | `KAYROS_AUDIT_ANCHOR_INTERVAL_MS` | période d'ancrage automatique (défaut 1 h, `0` = manuel) |
   | `KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN` / `KAYROS_AUDIT_ANCHOR_GIST_ID` | ancrage dans un gist (jeton au seul droit `gist`) |

3. Contrôler : `GET /health` → `auditEvidence: { enabled: true, kid }`. Une clé invalide n'empêche pas le démarrage : `enabled: false` et un avertissement dans les logs.

Endpoints :

- `GET /v1/audit/evidence` : kid, clé publique, chaîne de session, têtes signées, dernier ancrage (public, rien de secret).
- `GET /v1/audit/evidence/public-key` : clé publique PEM.
- `POST /v1/audit/evidence/anchor` (`x-kayros-secret` requis, corps `{ note?, force? }`) : ancrage immédiat.

Les événements de l'essaim et de la passerelle hybride sont scellés. Sans `runId`, ils rejoignent une chaîne de session `session-<date>-<aléa>` propre à chaque démarrage ; une chaîne nommée reprend sa tête depuis son fichier après redémarrage, sans rupture.

## Ancrage externe des têtes

Un manifeste `kayros-anchor/0.1` signé liste `(chain, seq, head)` pour chaque chaîne. Une fois publié hors du serveur, toute réécriture (même par le détenteur de la clé), troncature ou suppression d'un journal antérieur devient détectable.

```bash
# depuis une machine distincte (cron), après copie des journaux :
KAYROS_AUDIT_SIGNING_KEY_FILE=keys/audit-signing.key.pem \
  node scripts/anchor-audit-chain.mjs data/audit --pubkey keys/audit-signing.pub.pem --out /mnt/ancres
# + gist secret (révisions horodatées par GitHub) :
KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN=... node scripts/anchor-audit-chain.mjs data/audit --pubkey keys/audit-signing.pub.pem --gist
```

Le script vérifie d'abord tous les journaux et **refuse d'ancrer** une chaîne invalide. Il écrit `anchor-<horodatage>-<empreinte>.json` et ajoute une ligne à `anchors.jsonl`. Pour un horodatage tiers supplémentaire, le manifeste peut être soumis à une TSA RFC 3161 (`openssl ts -query -data anchor-….json`) ; ce n'est pas automatisé.

## Vérification par un tiers

```bash
node scripts/verify-audit-chain.mjs --keygen ./keys          # paire Ed25519 (garder la clé privée secrète)
node scripts/verify-audit-chain.mjs logs/<runId>.jsonl --pubkey keys/audit-signing.pub.pem [--checkpoint cp.json]
# dossier complet + ancres publiées (manifeste .json ou anchors.jsonl, option répétable) :
node scripts/verify-audit-chain.mjs data/audit --pubkey keys/audit-signing.pub.pem --anchor /mnt/ancres/anchors.jsonl [--json]
```

Résultat binaire (code 0 / 1, 2 = usage) et première rupture : contenu modifié, signature invalide, clé inconnue, séquence ou chaînage rompu, journal tronqué, manifeste modifié, empreinte différente d'une ancre, chaîne ancrée absente (journal supprimé).

## Correspondance avec le brouillon (indicative)

| Propriété PoC (C7) | Pilote |
|---|---|
| Contemporaine | scellée à l'append, pas reconstruite après coup |
| Infalsifiable de façon détectable | chaîne SHA-256 + Ed25519 |
| Binaire | vérification ok / échec |
| Transparente sur la confiance résiduelle | voir ci-dessous |

## Confiance résiduelle et limites

- Le détenteur de la clé privée peut encore réécrire ce qui a été produit **depuis le dernier ancrage**, et il signe aussi les manifestes : l'ancrage ne vaut que si la destination échappe à son contrôle (stockage d'une autre équipe, gist, TSA). Sans ancrage, on reste proche du niveau 2.
- Clé dans une variable ou un fichier : pas de KMS/HSM ; la même clé signe journaux et manifestes.
- Complétude non garantie : seuls les événements passés par le sink sont prouvés ; pas de passerelle d'interception sans contournement (C7.1).
- Rotation manuelle : plusieurs `--pubkey` acceptées à la vérification, pas de révocation.
- Format maison proche de RFC 8785, pas le profil CWT/CBOR ni les vecteurs `poc-evidence-vectors`.
- Les payloads sont en clair : la minimisation des données (C2) reste à faire.

- Aucune revendication de conformité Proof-of-Control : pilote technique seulement.
