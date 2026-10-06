# Console KayrosLab — parcours opératoire et recette

Ce document accompagne `CAHIER-DES-CHARGES-CONSOLE.md`. Il distingue ce qui est opérable dans le produit de ce qui dépend encore de secrets ou de services externes.

## Politique produit retenue

- Un `contributeur` voit uniquement les sessions qu’il a créées, ainsi que leurs threads et leur activité. Les rôles `comex` et `admin` conservent la vue du tenant.
- L’arbitrage final reste réservé aux rôles `comex` et `admin`. Un contributeur peut répondre à une demande de précision et relancer son collectif, mais l’interface ne lui propose plus d’action interdite.
- La configuration des agents, profils, impersonators et connecteurs reste réservée à `comex` et `admin`.
- Le provider effectif est affiché dans chaque contribution. `mock` signifie **simulation structurée** : le JSON est exploitable par le harness, mais ne constitue pas une analyse réelle. Pour une décision réelle, configurer `MISTRAL_API_KEY` ou un provider supporté.
- Salon est un service distinct. Les auteurs et Sales Oracle ne font pas partie du workbench Console.

## Recette du parcours principal

1. Créer un compte contributeur et ouvrir `/console/`.
2. Créer une session avec au moins un agent actif. Vérifier que la nouvelle session est immédiatement sélectionnée.
3. Lancer une mission. Vérifier que chaque contribution expose un provider et un verdict `GO`, `NO_GO` ou `CONDITIONAL_GO`.
4. Ouvrir `#activity`. Vérifier que la liste Décisions remplace bien le contenu précédent.
5. Ouvrir le dossier. Avec un contributeur, vérifier la notice « Arbitrage réservé aux rôles COMEX et admin » et l’absence de boutons actifs d’arbitrage.
6. Avec un compte COMEX/admin, accepter ou réévaluer le consensus et vérifier la mise à jour durable du thread.
7. Avec deux contributeurs du tenant `default`, vérifier qu’aucun ne voit les sessions, threads ou activités de l’autre.

## Connecteurs Slack, Discord et Teams

Prérequis communs :

- `KAYROS_CONNECTOR_ENCRYPTION_KEY` pour le stockage chiffré des secrets ;
- `KAYROS_PUBLIC_API_URL=https://api.kayroslab.com` pour construire les callbacks ;
- rôle `comex` ou `admin` dans la Console.

| Plateforme | Connexion simplifiée | Variables minimales |
| --- | --- | --- |
| Slack | OAuth | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` |
| Discord | invitation bot | `DISCORD_CLIENT_ID` (ou `DISCORD_APPLICATION_ID`), `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY` |
| Teams | consentement administrateur | `TEAMS_APP_ID`, `TEAMS_BOT_PASSWORD`, éventuellement `TEAMS_OAUTH_TENANT` |

Après modification de l’environnement, redémarrer l’API, ouvrir Réglages, connecter la plateforme, puis utiliser **Tester**. Le statut attendu passe de `not_configured` à `configured`, puis `connected` après un test réussi. Sans ces secrets, l’UI indique explicitement que la connexion simplifiée est indisponible ; ce n’est pas présenté comme un succès.

## Crystal Knows et LinkedIn

- Crystal Knows nécessite `CRYSTALKNOWS_API_TOKEN`.
- LinkedIn nécessite `LINKEDIN_ACCESS_TOKEN` pour l’intégration serveur. À défaut, un export autorisé ou une saisie manuelle reste possible.
- Tout import exige un consentement explicite et un rôle `comex` ou `admin`.
- Un import réussi renseigne `human_profile` sur l’agent, notamment le nom assigné, le type DISC, les motivations, le style de communication, les directives et les sources consenties. La Console affiche alors le profil comme « hybride consenti ».
- Aucun scraping LinkedIn n’est utilisé.

## Impersonator et swarm avancé

1. Se connecter avec un rôle `comex` ou `admin`.
2. Dans Agents, créer un impersonator avec un nom, une mission, des indices de persona, un portrait HTTPS ou data-URI image si souhaité, et le consentement explicite.
3. Vérifier que l’agent apparaît dans le registre.
4. Créer une équipe d’impersonators ; la création ouvre une session attachée à ces personas.
5. Lancer une mission smoke, vérifier les verdicts structurés, puis arbitrer avec le même rôle autorisé.

Les personas sont toujours signalées comme simulations : elles ne sont ni des identités réelles ni des citations authentiques.

## SMTP et mot de passe oublié

Le lien « Mot de passe oublié ? » n’est affiché que si un mailer est réellement configuré. Variables prises en charge : `KAYROS_SMTP_URL`, ou `KAYROS_SMTP_HOST`, `KAYROS_SMTP_PORT`, `KAYROS_SMTP_USER`, `KAYROS_SMTP_PASS` (ou `KAYROS_SMTP_PASSWORD`), `KAYROS_SMTP_SECURE` et `KAYROS_MAIL_FROM`.

La livraison du code ne crée pas de relais SMTP et n’invente pas de secret de production. Après configuration opérateur, vérifier `smtp.configured: true` dans le health, demander un reset sur une boîte de test, recevoir le message, consommer le lien une fois et vérifier la révocation des anciennes sessions.

## Démo et Workbench

- La validation JavaScript de la démo est bloquante dans le déploiement.
- Si le provider mock renvoie une carte sémantique non parsable, le serveur puis le client disposent d’un fallback local structuré, explicitement signalé comme mode dégradé.
- Les validations utilisent un message intégré à la page et non `alert()`.
- `/workbench` redirige vers `/workbench/`, publié comme point d’entrée alternatif du harness Console.

## Checklist de livraison

- [ ] S1 Auth + session créée et auto-sélectionnée
- [ ] S2 Mission nominale, verdicts parsables, provider visible
- [ ] S3 Politique d’arbitrage cohérente contributeur / COMEX-admin
- [ ] S4 Navigation `#activity`
- [ ] S5 Isolation entre deux contributeurs du tenant `default`
- [ ] S6 Démo sans erreur de syntaxe et carte sémantique franchie
- [ ] S7 SMTP réel vérifié après fourniture des secrets opérateur
- [ ] S8 `/workbench` non 404
- [ ] S9 Aucune alerte native dans la démo
- [ ] S10 Connecteur testé après fourniture de ses secrets
- [ ] S11 Import personality vérifié ou indisponibilité clairement affichée
- [ ] S12 Impersonator/team créé et mission smoke exécutée

Les cases S7, S10 et l’import Crystal/LinkedIn distant restent conditionnées à la fourniture de secrets externes valides. Elles ne doivent être cochées qu’après un test réel.
