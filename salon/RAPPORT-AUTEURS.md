# Rapport — extension du catalogue du Salon

Date : 23 novembre 2026. Branche `main`, dépôt KayrosLab. Aucun commit effectué :
les fichiers sont laissés dans le working tree.

## Résultat

**16 auteurs ajoutés**, tous du domaine public et vérifiés par le RDF Gutenberg.
Le catalogue passe de 68 à **84 auteurs** et de 417 à **491 œuvres** (+74).
Le portail publie **84 packs**, **21 671 phrases** et **6 771 formules**
(médiane 265 phrases/auteur).

| Auteur | Profil | Langue | Œuvres vérifiées (ID Gutenberg) | Phrases | Formules |
|---|---|---|---:|---:|---:|
| Pierre Corneille | tragédie classique | fr | 31628, 34445, 63174, 36011, 39739, 46527 | 329 | 83 |
| Jean de La Bruyère | moraliste | fr | 17980 | 226 | 83 |
| Alexis de Tocqueville | philosophie politique | fr | 54339, 30513, 30514, 30515, 30516 | 353 | 84 |
| Henry David Thoreau | essai américain | en | 71, 205, 1022, 2567, 4066, 4232 | 329 | 82 |
| Edmund Burke | philosophie politique | en | 2173, 5655 | 170 | 82 |
| Mary Wollstonecraft | philosophie morale et politique | en | 134, 3420, 16357, 26590, 36507, 64275 | 338 | 81 |
| Thomas Paine | républicanisme | en | 147, 3741, 3742, 3743, 31271 | 333 | 81 |
| George Eliot | roman victorien | en | 145, 507, 550, 2165, 2171, 6688 | 320 | 81 |
| W. M. Thackeray | roman victorien | en | 599, 897, 1462, 1933, 1935, 1969 | 308 | 81 |
| Elizabeth Gaskell | roman industriel | en | 394, 2153, 2521, 2522, 2524 | 313 | 81 |
| Anthony Trollope | roman victorien | en | 5709, 619, 814, 2158, 2432, 2860 | 337 | 81 |
| John Ruskin | essai, économie politique | en | 701, 1293, 4701, 7227, 7291, 8523 | 324 | 82 |
| Plutarque | philosophie morale | en | 674, 23639, 57513, 58567, 14033 | 337 | 80 |
| Lucrèce | épicurisme | en | 785 | 223 | 80 |
| Érasme | humanisme | en | 8400, 9371, 14500, 14746, 28338, 30201 | 330 | 81 |
| Thomas More | utopie politique | en | 2130, 17075 | 166 | 81 |

Total nouveau : **74 œuvres, 4 736 phrases, 1 304 formules**. Aucun pack ne
descend sous le seuil : le minimum est Thomas More avec 166 phrases.

## Refus explicite — Carl Gustav Jung

**Jung est refusé.** Il est mort le **6 juin 1961** ([Wikipédia](https://en.wikipedia.org/wiki/Carl_Jung)).
Ses œuvres ne sont donc pas du domaine public de façon sûre : la protection
court 70 ans après la mort de l'auteur (jusqu'en 2031-2032 en Suisse et dans
l'UE), et les publications américaines postérieures à 1929 peuvent encore être
protégées. Le Salon n'accepte que des textes dont la disponibilité est vérifiée :
intégrer Jung imposerait une édition sous licence, hors du périmètre de ce lot.

Remplaçants sûrement libres proposés : **Schopenhauer**, **Sénèque**,
**Épictète**. Ces trois auteurs sont déjà au catalogue et possèdent un pack
publié ; ils n'ont donc pas été ajoutés une seconde fois. À défaut, les
nouveaux profils de ce lot couvrent la même veine morale et politique
(Plutarque, Lucrèce, Érasme, More, Burke, Wollstonecraft, Tocqueville).

## Autres candidats écartés

| Candidat | Raison |
|---|---|
| François de La Rochefoucauld | Gutenberg ne propose que les *Maximes* en néerlandais (#68079) ; aucune édition française ou anglaise vérifiée. Un pack francophone serait impossible sans autre source. |
| Anton Tchekhov | Le seed existe déjà dans `NEW_AUTHORS`, mais la vérification RDF ne retient aucune œuvre (0) : il n'est pas publié. |
| Adam Ferguson, Thomas Reid | Cherchés dans GUTINDEX : aucune entrée Gutenberg. Les Lumières écossaises restent représentées par Adam Smith et David Hume, déjà présents. |
| Vauvenargues | Aucune entrée Gutenberg. |
| Jean de La Fontaine | Seed antérieur au lot, non retenu ici pour ne pas dépasser le plafond de 16 auteurs ; ses Fables restent éligibles lors d'un prochain passage. |

Candidats demandés déjà présents au catalogue (donc non réajoutés) : Sénèque,
Épictète, Marc Aurèle, Descartes, Pascal, Hobbes, Locke, Hume, J.-S. Mill,
Schopenhauer, Cicéron, Racine, Molière, Emerson, Whitman, Melville, Cervantès,
Dante, Shakespeare.

## Méthode et corrections

- Chaque œuvre est vérifiée par le RDF Gutenberg (`dcterms:rights`,
  `dcterms:language`, `pgterms:agent`) avant d'entrer au catalogue. Aucune
  œuvre n'est saisie à la main.
- **Homonymes** : ajout d'un champ `exclude` au seed, appliqué à l'auteur
  GUTINDEX puis au premier agent RDF. Il écarte Mary Shelley (pour
  Wollstonecraft), Anne Thackeray Ritchie (pour Thackeray), Walter Gaskell,
  Frances/Adolphus Trollope, Thomas Corneille, Erasmus Darwin et Paul Carus
  (pour Lucrèce). Sans cela, « The Prisoner of Zenda » (Anthony Hope) et
  « The Gospel of Buddha » (Paul Carus) entraient dans les mauvais packs.
- **Bug de nom de famille** : `familyKeys` prenait le dernier mot de
  `'Trollope, Anthony'`, donc « Anthony ». Corrigé : la forme inversée donne
  le nom avant la virgule.
- **Corneille** : les tomes Gutenberg sont à plus de 50 % un appareil critique
  (notice biographique de Marty-Laveaux). Un `startAt` sur la première scène a
  été ajouté aux cinq tomes pour ne récolter que le théâtre.
- **Œuvres écartées après inspection** : « A House to Let » (#2324), roman
  collaboratif dont l'agent RDF principal est Dickens, retiré de Gaskell ;
  « The Boys' and Girls' Plutarch » (#2484), abrégé pour enfants qui paraphrase
  Plutarque, retiré.
- **Encodage** : les fichiers Gutenberg `-8.txt` sont en Latin-1. `textlib.mjs`
  détecte les U+FFFD et rebascule sur windows-1252, sinon les accents français
  sortaient en mojibake.
- **Panne Gutenberg** : `www.gutenberg.org` était en maintenance (503) pendant
  la session. La récolte a utilisé le miroir Waterloo déjà prévu par
  `fetchWorkText` ; les URLs du catalogue restent canoniques.

## Vérifications

| Contrôle | Résultat |
|---|---|
| `publish_gate.mjs --skip-build` | ✓ 84 packs, 21 671 phrases, 6 771 formules |
| Couverture catalogue | 100 % (84/84) |
| Tours du jeu d'or | 100 % conformes |
| Distance de voix moyenne | 0,384 (seuil 0,12) |
| Audit de citations | 84 ok, 0 sans source, **0 échec** |
| `node --test tests/salon-speech.test.mjs` | **7/7 pass**, 0 fail |
| `publish_pages.mjs` | ✓ page et 84 packs copiés dans `salon/` |

Les avertissements restants du rapport de parole concernent des auteurs
antérieurs (langue de Balzac, Rousseau, Verne, etc.) ; aucun ne vise les
16 nouveaux packs.

## Fichiers modifiés

- `salon/scripts/enrich_catalog.mjs` : 16 seeds, champ `exclude`, options
  `--new-only` et `--seed-ids`, correction `familyKeys`.
- `salon/scripts/textlib.mjs` : décodage Latin-1 des fichiers `-8.txt`.
- `salon/scripts/publish_gate.mjs` : le catalogue est copié dans le staging
  avant promotion (sinon la page publiée restait à 68 auteurs).
- `salon/src/lib/salon/catalog.json` : 84 auteurs, 491 œuvres.
- `salon/src/lib/salon/corpus.json`, `salon/catalog.json`, `salon/kb/`,
  `salon/kb-manifest.json`, `salon/kb-map.json`,
  `backend/web/public/salon/` (catalogue, corpus, formules, manifeste, packs) :
  artefacts régénérés par le portail et `publish_pages.mjs`.
- `docs/SALON-QUALITE.md` : procédure « Ajouter un auteur » actualisée.
- `salon/scripts/reports/` : rapports du jour (catalogue, récolte, audit,
  portail, parole).

**Front** : `app.js`, `index.html` et `style.css` portent le chantier
« portraits » d'un autre agent, en cours concurremment. Je ne les ai pas
édités ; `publish_pages.mjs` les a recopiés du miroir backend vers `salon/`
comme il le fait toujours. Les fichiers `avatars.json` et `avatars/` sont de
ce même chantier, pas de ce lot.

## Limites

- La Rochefoucauld reste absent faute de texte Gutenberg ; il faudrait une
  autre source domain public (Gallica, par exemple) et une vérification
  d'édition.
- Les nouveaux auteurs n'ont pas d'ancres de doctrine : le régime de doctrine
  fonctionne, mais le contrôle `min-doctrine` ne les concerne pas encore.
- Le seuil de 120 phrases est respecté par les packs, pas par le corpus brut :
  l'export dédoublonne et filtre les phrases non citables.
