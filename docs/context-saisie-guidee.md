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
