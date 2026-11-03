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
| `linkedin`, `crystalknows`, `export`, `manual`, `enriched` | `consent_confirmed: true` obligatoire. |

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
