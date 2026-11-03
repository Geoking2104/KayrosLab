# Saisie manuelle & reformulation guidée du contexte

- **Saisie manuelle** : Bibliothèque → Sources de contexte → Nouvelle source. « Saisie » = *Libre* (texte direct, actif immédiatement, comme avant) ou guidée *RFP / AO* / *Projet interne*. Rattachement société → projet → nœud et agents/collectifs inchangés.
- **Modes guidés** (`core/context-rephrase.mjs`) :
  - RFP / AO : demande initiale du client, contexte interne, contexte côté client, équipe qui décide.
  - Projet interne : périmètre, contexte société, contexte projet, compétences disponibles.
- **Reformuler / confirmer la compréhension** : `POST /v1/console/context/rephrase` `{ type: rfp|interne|skill, raw, fields }` → `{ source: model|draft, structured, brief, missing, questions, error? }`. Appel via `KayrosLLM.complete` (harnais injecté, mode `flag` : on restitue la demande, on ne la juge pas). Échec modèle / JSON invalide → `source: draft`, le brouillon reste intact. Rien n'est enregistré par cet appel.
- **Validation** : le brief reste éditable ; « Valider cette compréhension » enregistre `status: validated` (`validated_by`, `validated_at`) et le brief devient `content`. « Garder en brouillon » → `status: draft`.
- **Seules les sources validées** (ou sans statut : historiques et saisie libre) sont injectées : cascade projet, collectifs, métadonnées d'agents. `GET /projects/:id/context` renvoie aussi `pending` (brouillons du périmètre).
- **Contexte modifié** : changer `raw_input` d'une source guidée validée sans statut explicite la repasse en brouillon.
- **Avant lancement** (Projets → Enchaînement) : liste des briefs transmis (Validé) et des brouillons non transmis, avec « Reformuler à nouveau » et « Valider ».
- **Skills** : création/édition manuelle inchangée ; bouton optionnel « Reformuler l'objectif du skill » (`type: skill`) qui propose une description éditable.

## Tags de skills (RFP / interne)

Chaque skill peut être tagué `rfp` et/ou `interne` (`tags`, 2 max). Dans la Bibliothèque, les boutons « Modèle RFP » et « Modèle interne » ajoutent le tag et pré-remplissent les instructions quand elles sont vides. Un filtre Tous / RFP / Interne s'affiche au-dessus de la liste.

## Briefs avant lancement (Instruct et Projets)

`GET /v1/console/sessions/:id/briefs` renvoie `{validated, pending}` pour un collectif. Seuls les `validated` sont injectés. Les écrans Instruct (collectif sélectionné) et Projets → Enchaînement affichent le même panneau :

- **Reformuler à nouveau** sur un brouillon montre un diff mot à mot entre la dernière version validée (`validated_content`) et la nouvelle reformulation. Rien n'est écrit tant que vous n'avez pas cliqué sur « Valider la nouvelle version » ; « Écarter » abandonne la proposition.
- **Valider** valide le brouillon tel quel.
- **Invalider** (sur une source guidée validée) appelle `POST /v1/console/contexts/:id/invalidate {reason}` et la repasse en brouillon.

## Retour en brouillon automatique (déclencheurs)

Seules les sources **guidées** (`mode` renseigné) et **validées** repassent en `draft`, avec `invalidated_reason`, `invalidated_at` et `invalidated_by`. L'élément modifié lui-même n'est jamais concerné, et les sources libres non plus.

| Changement | Champs déclencheurs | Sources repassées en brouillon |
|---|---|---|
| Source de contexte active créée, modifiée ou supprimée | `content`, `url`, `company_id`, `project_id`, `node_id`, `session_ids`, `agent_ids` | même entreprise (et ses projets) si niveau entreprise ; même projet si niveau projet ; collectifs en commun |
| Skill créé, modifié ou supprimé | champs versionnés (description, instructions, tools), `tags`, `session_ids`, `agent_ids` | sources qui partagent un collectif ou un agent |
| Projet modifié | `name`, `goal`, `company_id`, `session_ids` | sources du projet (`project_id`) |
| Source guidée elle-même : `raw_input` modifié | — | elle-même (brouillon) |

Un changement de statut seul (valider / invalider) ne déclenche rien, ce qui évite les cascades en ping-pong. Une source en brouillon créée ou modifiée n'invalide pas ses voisines (elle n'est pas injectée). La validation enregistre `validated_content` et efface `invalidated_reason`.
