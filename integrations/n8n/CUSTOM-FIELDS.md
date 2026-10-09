# Option : champs KayrosLab sur l'opportunité

Le PoC écrit une **tâche** sur l'opportunité, sans toucher au modèle de données Salesforce. Pour filtrer, faire des rapports ou des tableaux de bord (« opportunités en NO GO ce trimestre »), ajoutez quatre champs personnalisés sur **Opportunity**. Le workflow 2 les met alors à jour.

## 1. Créer les champs (Setup → Object Manager → Opportunity → Fields & Relationships → New)

| Libellé | Nom API | Type | Valeurs / format |
|---------|---------|------|------------------|
| Verdict KayrosLab | `Kayros_Verdict__c` | Picklist | `GO`, `CONDITIONAL_GO`, `NO_GO`, `NEEDS_CLARIFICATION` |
| Statut KayrosLab | `Kayros_Statut__c` | Picklist | `À arbitrer`, `Arbitré`, `Échec` |
| Score KayrosLab | `Kayros_Score__c` | Number (3, 0) | 0 à 100 : adhésion du collectif (GO = 1, CONDITIONAL GO = 0,5, NO GO = 0) |
| Dossier KayrosLab | `Kayros_Dossier__c` | URL | lien vers le dossier dans la console |

Pour chaque champ :
- **sécurité au niveau du champ** : lecture pour les commerciaux, **modification pour l'utilisateur de l'intégration** (celui qui a connecté Salesforce dans n8n) ;
- ajout à la **mise en page** de l'opportunité, par exemple dans une section « KayrosLab ».

> Pour les picklists, décochez *Restrict picklist to the values defined in the value set* si vous préférez accepter toute nouvelle valeur envoyée par KayrosLab.

## 2. Activer le nœud dans n8n

Workflow **KayrosLab → Salesforce : verdict et arbitrage** → nœud *Champs KayrosLab sur l'opportunité (option)* → clic droit → **Activate**. Sélectionnez l'identifiant Salesforce, enregistrez.

Après un arbitrage humain, `Kayros_Verdict__c` prend la **décision humaine**, et le statut passe à « Arbitré ».

## 3. Exemples d'usage

- Vue de liste « Deals à arbitrer » : `Kayros_Statut__c = À arbitrer`.
- Règle de validation : interdire le passage à *Closed Won* si `Kayros_Verdict__c = NO_GO` et `Kayros_Statut__c != Arbitré`.
- Rapport : montant total par verdict KayrosLab et par trimestre.

## Retirer l'option

Désactivez le nœud : les champs restent en place mais ne sont plus mis à jour. Supprimer les champs dans Salesforce efface leur historique.
