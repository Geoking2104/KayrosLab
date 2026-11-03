# Catalogue de modèles de personas

Archétypes **anonymes** de parties prenantes, prêts à copier. Un modèle ne désigne personne : il n'a
ni `name`, ni `source`. Il sert de point de départ :

- dans la console (Agents → « Partir d'un modèle ») : le modèle pré-remplit la fiche, l'opérateur
  saisit ensuite le nom et la source (`public` + URLs publiques, ou consentement pour les autres sources) ;
- en fichier : copier le modèle dans `personas/`, ajouter `name`, `source` (et `public_sources` ou
  `consent_confirmed: true`).

Ce dossier n'est **pas** chargé au démarrage (seuls les fichiers à la racine de `personas/` le sont).
Garde-fous IMP_01…05, veto et harnais s'appliquent dès la création, comme pour toute persona.

Champs : `id`, `template_title`, `description`, `role`, `department`, `purpose`, `veto_power`, `mission`, `clues`.
