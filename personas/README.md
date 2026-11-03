# Personas déclaratives — un fichier par persona

Chaque fichier `.yaml` (ou `.json`) de ce dossier déclare **une** persona impersonator. Au démarrage,
le backend (`backend/fastify/index.mjs`) appelle `synchronizePersonaPackage` (`core/persona-package.mjs`) :

- chaque fichier passe par `normalizeImpersonator` → `impersonatorAgentDefinition` (`core/impersonator.mjs`),
  donc par les garde-fous `IMP_01…IMP_05`, `veto_power` activé par défaut et le harnais LLM ;
- un fichier invalide est **rejeté et journalisé** ;
- la synchronisation est idempotente : un agent déjà présent (même `id`) n'est jamais écrasé.

Ajouter une persona : créer un fichier (ou copier un modèle de `catalog/`). La retirer : supprimer le
fichier (l'agent déjà créé reste dans le registre et se gère depuis la console).

## Règle de consentement

| `source` | Exigence |
|---|---|
| `public` | Persona bâtie **uniquement sur des données publiques** : consentement non requis, mais `public_sources` (liste non vide d'URLs http(s)) obligatoire. |
| `linkedin`, `crystalknows`, `export`, `manual`, `enriched` | Persona **consentie par défaut** ; seul `consent_confirmed: false` explicite bloque la création. |

## Format

```yaml
id: imposteur_exemple          # optionnel (sinon nom du fichier)
name: Prénom Nom
role: Directrice des achats
company: Exemple SA
source: public
public_sources:
  - https://exemple.com/equipe/prenom-nom
purpose: idea_test             # idea_test | objection_rehearsal | pitch_review
veto_power: true               # défaut true
clues:
  - Insiste publiquement sur le coût total de possession
portrait_url: https://…        # optionnel, https ou data:image
```

Variables : `KAYROS_PERSONAS_DIR` (dossier, `off` pour désactiver), `KAYROS_PERSONAS_TENANT_ID` (tenant cible).

## Base publique associée

Les URLs `public_sources` sont enregistrées sur la persona puis visitées côté serveur (http(s) uniquement, IP privées/localhost refusées, délai et taille bornés). Statut, titre, extrait, date et empreinte sont stockés dans `public_evidence` et nourrissent le profil via `profile-enrichment`.

## Skills (`skills.yaml`)

`skills.yaml` (exclu du chargement des personas) déclare un catalogue `{ id, name, instructions, tools }`. Une persona référence des skills par id :

```yaml
skills: [objection_roi, veille_reglementaire]
tools: [estimate_resources]   # allowlist explicite, optionnelle (vide par défaut)
```

Un id inconnu rejette la persona. Les outils **effectifs** sont l'intersection des outils du skill et de l'allowlist de la persona, chacun passant `assertToolAllowed` (pas de wildcard en écriture, porte humaine `gate`). Un skill n'élargit jamais les droits. Endpoints : `GET /v1/console/persona-skills`, `GET /v1/console/agents/:agentId/skill-tools`.
