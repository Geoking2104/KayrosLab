# Avatars des auteurs du Salon

Portraits des 68 entrées du catalogue `salon/catalog.json`, récupérés depuis l'API de Wikipédia
puis normalisés en JPEG de 320 px de large.

## Provenance et méthode

- Source : API MediaWiki de Wikipédia (`fr.wikipedia.org`, puis `en.wikipedia.org` en second recours),
  en partant du champ `wikipedia` du catalogue ; recherche par nom si la page indiquée n'existe pas.
- Image : vignette de tête de l'article (`prop=pageimages`), redimensionnée à **320 px de large**,
  ratio conservé, JPEG qualité 90. Aucun recadrage, aucun retouchage.
- Crédit et licence : lus dans les métadonnées Commons du fichier (`prop=imageinfo&iiprop=extmetadata`),
  champs `Artist` et `LicenseShortName`, et non déduits.
- `generatedAt` : 2026-11-23T09:24:16.038Z

## Contenu

- **62 portraits** de personnes (peintures, gravures, photographies, bustes) ;
- **6 images d'œuvres** pour les entrées `kind: "tradition"` (Bible, Torah, Coran, Bhagavad-Gîta,
  Dhammapada, Tao Tö King) : ce ne sont pas des personnes, l'image est celle de l'article Wikipédia
  correspondant (manuscrit, rouleau, folio). Ces six entrées ont encore `avatar: "…/<id>.svg"` dans
  `catalog.json` ; le passage à `<id>.jpg` relève d'une modification du catalogue, hors de cette tâche.
- 68 fichiers, tous ≥ 8 Ko et décodables (vérifié par Pillow après écriture).

## Licences

- **59 fichiers en domaine public** (mention `Public domain` fournie par Commons ; vérifier la fiche
  avant tout usage commercial, certaines mentions `PD-Art` dépendent de la juridiction).
- **8 fichiers sous licence Creative Commons** (attribution obligatoire) et **1 en CC0** :

  - `aristote` — CC BY-SA 2.5 — Eric Gaba (User:Sting) — [fiche](https://commons.wikimedia.org/wiki/File:Aristoteles_Louvre.jpg)
  - `marcaurele` — CC BY-SA 4.0 — Daniel Martin — [fiche](https://commons.wikimedia.org/wiki/File:MSR-ra-61-b-1-DM_(cropped).jpg)
  - `suntzu` — CC BY 2.5 — 663highland — [fiche](https://commons.wikimedia.org/wiki/File:Enchoen27n3200.jpg)
  - `seneca` — CC BY-SA 3.0 — Calidius — [fiche](https://commons.wikimedia.org/wiki/File:Duble_herma_of_Socrates_and_Seneca_Antikensammlung_Berlin_07.jpg)
  - `ciceron` — CC BY-SA 4.0 — José Luiz — [fiche](https://commons.wikimedia.org/wiki/File:Bust_of_Cicero_(1st-cent._BC)_-_Palazzo_Nuovo_-_Musei_Capitolini_-_Rome_2016.jpg)
  - `christianisme` — CC BY-SA 2.0 — NYC Wanderer (Kevin Eng) — [fiche](https://commons.wikimedia.org/wiki/File:Gutenberg_Bible,_Lenox_Copy,_New_York_Public_Library,_2009._Pic_01.jpg)
  - `judaisme` — CC BY-SA 4.0 — HOWI - Horsch, Willy — [fiche](https://commons.wikimedia.org/wiki/File:K%C3%B6ln-Tora-und-Innenansicht-Synagoge-Glockengasse-040.JPG)
  - `islam` — CC BY-SA 4.0 — Mustafa-trit20 — [fiche](https://commons.wikimedia.org/wiki/File:Mamluk_era_Quran,_circa_1380,_open_to_sura_16.jpg)
  - `bouddhisme` — CC0 — Auteur inconnu — [fiche](https://commons.wikimedia.org/wiki/File:Folios_of_the_Bhikkhuni-patimokkha_(BL_IO_Man.Pali_21).jpg)

Les versions redimensionnées des fichiers CC BY / CC BY-SA sont distribuées sous la même licence que
l'original ; le crédit ci-dessus doit rester visible (ou accessible) là où l'avatar est affiché.

## Vérification, fiche par fiche

Le manifeste `avatars.json` reprend `file`, `page`, `credit`, `license`, plus `type` et `filePage`
(fiche Commons du fichier, où figure la licence complète). Avant toute republication :

1. ouvrir `filePage` et confirmer la licence et le crédit ;
2. vérifier les éventuelles `Restrictions` (droits voisins, `trademark`) ;
3. pour un fichier CC BY-SA, conserver l'attribution et signaler la modification (redimensionnement).

Aucune image n'est déclarée dans le domaine public sans la mention correspondante sur sa fiche Commons.

## Limites connues

- Certains auteurs n'ont aucun portrait d'après nature : l'image est alors un buste antique
  (Aristote, Platon, Sénèque, Épicure…), une statue (`suntzu`) ou une enluminure (`boece`).
- Les vignettes de `berkeley`, `mill`, `schopenhauer` et `leibniz` étaient plus petites que 320 px à la
  source et ont été agrandies : netteté légèrement inférieure.
- `epictete` : la vignette de tête de l'article est une page de titre ; la gravure `Epictetus.png`
  (même article, domaine public) a été retenue après contrôle visuel.

## Portraits (62)

| Auteur | `id` | Fichier | Licence | Crédit (champ `Artist` de Commons) | Fiche du fichier |
| --- | --- | --- | --- | --- | --- |
| Adam Smith | `smith` | `smith.jpg` (66 Ko, 320×478) | Public domain | Etching created by Cadell and Davies (1811), John Horsburgh (1828) or R.C. Bell (1872). | [Commons](https://commons.wikimedia.org/wiki/File:AdamSmith.jpg) |
| Aristote | `aristote` | `aristote.jpg` (41 Ko, 320×427) | [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) | Eric Gaba (User:Sting) | [Commons](https://commons.wikimedia.org/wiki/File:Aristoteles_Louvre.jpg) |
| Baruch Spinoza | `spinoza` | `spinoza.jpg` (28 Ko, 320×371) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Spinoza.jpg) |
| Charles Darwin | `darwin` | `darwin.jpg` (45 Ko, 320×450) | Public domain | Herbert Rose Barraud | [Commons](https://commons.wikimedia.org/wiki/File:Charles_Darwin_portrait.jpg) |
| Confucius | `confucius` | `confucius.jpg` (57 Ko, 320×452) | Public domain | Confucius, gouache on paper, c. 1770. Encyclopedia Britannica. | [Commons](https://commons.wikimedia.org/wiki/File:Konfuzius-1770.jpg) |
| Edgar Allan Poe | `poe` | `poe.jpg` (30 Ko, 320×450) | Public domain | Auteur inconnu; restauré par Yann Forget et Adam Cuerden | [Commons](https://commons.wikimedia.org/wiki/File:Edgar_Allan_Poe,_circa_1849,_restored,_squared_off.jpg) |
| Emmanuel Kant | `kant` | `kant.jpg` (36 Ko, 320×418) | Public domain | Johann Gottlieb Becker (1720-1782) | [Commons](https://commons.wikimedia.org/wiki/File:Immanuel_Kant_-_Gemaelde_1.jpg) |
| Fiodor Dostoïevski | `dostoevski` | `dostoevski.jpg` (34 Ko, 320×415) | Public domain | Constantin Shapiro | [Commons](https://commons.wikimedia.org/wiki/File:Dostoevsky_1879.jpg) |
| Franz Kafka | `kafka` | `kafka.jpg` (25 Ko, 320×427) | Public domain | Photographe inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Franz_Kafka,_1923.jpg) |
| Friedrich Nietzsche | `nietzsche` | `nietzsche.jpg` (50 Ko, 320×371) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Portrait_of_Friedrich_Nietzsche.jpg) |
| Honoré de Balzac | `balzac` | `balzac.jpg` (32 Ko, 320×427) | Public domain | Louis-Auguste Bisson | [Commons](https://commons.wikimedia.org/wiki/File:%E5%A5%A5%C2%B7%E5%B7%B4%E5%B0%94%E6%89%8E%E5%85%8B.png) |
| Jane Austen | `austen` | `austen.jpg` (36 Ko, 320×547) | Public domain | From a watercolour by James Andrews of Maidenhead based on an unfinished work by Cassandra Austen. Engraving by William Home Lizars. | [Commons](https://commons.wikimedia.org/wiki/File:Jane_Austen,_from_A_Memoir_of_Jane_Austen_(1870).jpg) |
| Jean-Jacques Rousseau | `rousseau` | `rousseau.jpg` (50 Ko, 320×445) | Public domain | Maurice-Quentin de La Tour | [Commons](https://commons.wikimedia.org/wiki/File:Jean-Jacques_Rousseau_(painted_portrait).jpg) |
| Jules Verne | `verne` | `verne.jpg` (30 Ko, 320×448) | Public domain | Nadar | [Commons](https://commons.wikimedia.org/wiki/File:F%C3%A9lix_Nadar_1820-1910_portraits_Jules_Verne.jpg) |
| Karl Marx | `marx` | `marx.jpg` (26 Ko, 320×473) | Public domain | John Jabez Edwin Mayall | [Commons](https://commons.wikimedia.org/wiki/File:Karl_Marx_by_John_Jabez_Edwin_Mayall_1875_-_Restored.png) |
| Léon Tolstoï | `tolstoi` | `tolstoi.jpg` (47 Ko, 320×443) | Public domain | Sergueï Prokoudine-Gorski | [Commons](https://commons.wikimedia.org/wiki/File:L.N.Tolstoy_Prokudin-Gorsky.jpg) |
| Marc Aurèle | `marcaurele` | `marcaurele.jpg` (34 Ko, 320×430) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Daniel Martin | [Commons](https://commons.wikimedia.org/wiki/File:MSR-ra-61-b-1-DM_(cropped).jpg) |
| Michel de Montaigne | `montaigne` | `montaigne.jpg` (64 Ko, 320×413) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Montaigne-Dumonstier.jpg) |
| Miguel de Cervantès | `cervantes` | `cervantes.jpg` (25 Ko, 320×420) | Public domain | Attribué à Juan de Jáuregui | [Commons](https://commons.wikimedia.org/wiki/File:Cervantes_J%C3%A1uregui.jpg) |
| Nicolas Machiavel | `machiavel` | `machiavel.jpg` (28 Ko, 320×411) | Public domain | Santi di Tito | [Commons](https://commons.wikimedia.org/wiki/File:Portrait_of_Niccol%C3%B2_Machiavelli_by_Santi_di_Tito.jpg) |
| Oscar Wilde | `wilde` | `wilde.jpg` (37 Ko, 320×484) | Public domain | Downey, W. & D. | [Commons](https://commons.wikimedia.org/wiki/File:Oscar_Wilde_(1854-1900)_1889,_May_23._Picture_by_W._and_D._Downey.jpg) |
| Platon | `platon` | `platon.jpg` (53 Ko, 320×486) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Plato_Pio-Clemetino_Inv305.jpg) |
| René Descartes | `descartes` | `descartes.jpg` (33 Ko, 320×392) | Public domain | D’après Frans Hals | [Commons](https://commons.wikimedia.org/wiki/File:Frans_Hals_-_Portret_van_Ren%C3%A9_Descartes.jpg) |
| Stendhal | `stendhal` | `stendhal.jpg` (36 Ko, 320×410) | Public domain | Olof Södermark | [Commons](https://commons.wikimedia.org/wiki/File:Stendhal.jpg) |
| Sun Tzu | `suntzu` | `suntzu.jpg` (61 Ko, 320×481) | [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/) | 663highland | [Commons](https://commons.wikimedia.org/wiki/File:Enchoen27n3200.jpg) |
| Victor Hugo | `hugo` | `hugo.jpg` (25 Ko, 320×426) | Public domain | Nadar | [Commons](https://commons.wikimedia.org/wiki/File:Victor_Hugo_001.jpg) |
| Voltaire | `voltaire` | `voltaire.jpg` (28 Ko, 320×400) | Public domain | Nicolas de Largillierre | [Commons](https://commons.wikimedia.org/wiki/File:Atelier_de_Nicolas_de_Largilli%C3%A8re,_portrait_de_Voltaire,_d%C3%A9tail_(mus%C3%A9e_Carnavalet)_-002.jpg) |
| William Shakespeare | `shakespeare` | `shakespeare.jpg` (34 Ko, 320×408) | Public domain | Attribué à John Taylor | [Commons](https://commons.wikimedia.org/wiki/File:Shakespeare.jpg) |
| Sénèque | `seneca` | `seneca.jpg` (38 Ko, 320×395) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Calidius | [Commons](https://commons.wikimedia.org/wiki/File:Duble_herma_of_Socrates_and_Seneca_Antikensammlung_Berlin_07.jpg) |
| Cicéron | `ciceron` | `ciceron.jpg` (37 Ko, 320×480) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | José Luiz | [Commons](https://commons.wikimedia.org/wiki/File:Bust_of_Cicero_(1st-cent._BC)_-_Palazzo_Nuovo_-_Musei_Capitolini_-_Rome_2016.jpg) |
| Épictète | `epictete` | `epictete.jpg` (58 Ko, 320×493) | Public domain | Claude Reydellet, engraving by S. Beyssent | [Commons](https://commons.wikimedia.org/wiki/File:Epictetus.png) |
| Épicure | `epicure` | `epicure.jpg` (36 Ko, 320×480) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Epikouros_BM_1843.jpg) |
| Augustin d’Hippone | `augustin` | `augustin.jpg` (50 Ko, 320×408) | Public domain | Philippe de Champaigne | [Commons](https://commons.wikimedia.org/wiki/File:Saint_Augustine_by_Philippe_de_Champaigne.jpg) |
| Boèce | `boece` | `boece.jpg` (91 Ko, 320×470) | Public domain | Boethius | [Commons](https://commons.wikimedia.org/wiki/File:Bo%C3%A8ce_et_Philosophie.jpg) |
| Thomas d’Aquin | `aquinas` | `aquinas.jpg` (65 Ko, 320×480) | Public domain | Carlo Crivelli | [Commons](https://commons.wikimedia.org/wiki/File:St-thomas-aquinasFXD.jpg) |
| Thomas Hobbes | `hobbes` | `hobbes.jpg` (22 Ko, 320×337) | Public domain | John Michael Wright | [Commons](https://commons.wikimedia.org/wiki/File:Thomas_Hobbes_(portrait).jpg) |
| John Locke | `locke` | `locke.jpg` (21 Ko, 320×370) | Public domain | Godfrey Kneller | [Commons](https://commons.wikimedia.org/wiki/File:JohnLocke.png) |
| David Hume | `hume` | `hume.jpg` (24 Ko, 320×392) | Public domain | Allan Ramsay | [Commons](https://commons.wikimedia.org/wiki/File:Painting_of_David_Hume.jpg) |
| Gottfried Wilhelm Leibniz | `leibniz` | `leibniz.jpg` (38 Ko, 320×405) | Public domain | Christoph Bernhard Francke | [Commons](https://commons.wikimedia.org/wiki/File:Gottfried_Wilhelm_von_Leibniz.jpg) |
| Blaise Pascal | `pascal` | `pascal.jpg` (28 Ko, 320×381) | Public domain | Auteur inconnu; une copie d’une peinture de François II Quesnel; gravée par Gérard Edelinck en 1691. | [Commons](https://commons.wikimedia.org/wiki/File:Blaise_Pascal_Versailles.JPG) |
| George Berkeley | `berkeley` | `berkeley.jpg` (29 Ko, 320×439) | Public domain | John Smybert | [Commons](https://commons.wikimedia.org/wiki/File:George_Berkeley_by_Jonh_Smibert.jpg) |
| Georg Wilhelm Friedrich Hegel | `hegel` | `hegel.jpg` (47 Ko, 320×405) | Public domain | Jakob Schlesinger | [Commons](https://commons.wikimedia.org/wiki/File:Hegel_by_Schlesinger.jpg) |
| Arthur Schopenhauer | `schopenhauer` | `schopenhauer.jpg` (24 Ko, 320×395) | Public domain | Jules Lunteschütz (1822–1893) | [Commons](https://commons.wikimedia.org/wiki/File:Schopenhauer_by_Jules_Luntesch%C3%BCtz.jpg) |
| Søren Kierkegaard | `kierkegaard` | `kierkegaard.jpg` (48 Ko, 320×458) | Public domain | Luplau Janssen | [Commons](https://commons.wikimedia.org/wiki/File:Kierkegaard_1902_by_Luplau_Janssen.jpg) |
| John Stuart Mill | `mill` | `mill.jpg` (43 Ko, 320×475) | Public domain | John Watkins | [Commons](https://commons.wikimedia.org/wiki/File:John_Stuart_Mill_by_John_Watkins,_1865.jpg) |
| Ralph Waldo Emerson | `emerson` | `emerson.jpg` (29 Ko, 320×486) | Public domain | Southworth & Hawes | [Commons](https://commons.wikimedia.org/wiki/File:Ralph_Waldo_Emerson_ca1857.jpg) |
| William James | `james` | `james.jpg` (25 Ko, 320×424) | Public domain | Alice Boughton | [Commons](https://commons.wikimedia.org/wiki/File:William_James_by_Alice_M._Boughton,_c._1907,_platinum_print,_from_the_National_Portrait_Gallery_-_NPG-NPG_87_37James-000001_(cropped).jpg) |
| Denis Diderot | `diderot` | `diderot.jpg` (32 Ko, 320×398) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Denis_Diderot_111.PNG) |
| Molière | `moliere` | `moliere.jpg` (35 Ko, 320×400) | Public domain | Https://www.parismuseescollections.paris.fr/fr/musee-carnavalet/oeuvres/moliere-1622-1673-dans-le-role-de-cesar-de-la-mort-de-pompee | [Commons](https://commons.wikimedia.org/wiki/File:Moli%C3%A8re_-_Nicolas_Mignard_(1658).jpg) |
| Jean Racine | `racine` | `racine.jpg` (34 Ko, 320×328) | Public domain | D’après Jean-Baptiste Santerre | [Commons](https://commons.wikimedia.org/wiki/File:Portrait_de_Jean_Racine_d%27apr%C3%A8s_Jean-Baptiste_Santerre.jpg) |
| Montesquieu | `montesquieu` | `montesquieu.jpg` (31 Ko, 320×394) | Public domain | D’après Jacques-Antoine Dassier | [Commons](https://commons.wikimedia.org/wiki/File:Montesquieu_1.png) |
| Gustave Flaubert | `flaubert` | `flaubert.jpg` (25 Ko, 320×353) | Public domain | Nadar | [Commons](https://commons.wikimedia.org/wiki/File:Gustave_Flaubert.jpg) |
| Guy de Maupassant | `maupassant` | `maupassant.jpg` (32 Ko, 320×451) | Public domain | Nadar | [Commons](https://commons.wikimedia.org/wiki/File:Maupassant_par_Nadar.jpg) |
| Charles Baudelaire | `baudelaire` | `baudelaire.jpg` (22 Ko, 320×404) | Public domain | Étienne Carjat | [Commons](https://commons.wikimedia.org/wiki/File:%C3%89tienne_Carjat,_Portrait_of_Charles_Baudelaire,_circa_1862.jpg) |
| Charles Dickens | `dickens` | `dickens.jpg` (41 Ko, 320×467) | Public domain | Jeremiah Gurney | [Commons](https://commons.wikimedia.org/wiki/File:Dickens_Gurney_head.jpg) |
| Herman Melville | `melville` | `melville.jpg` (21 Ko, 320×395) | Public domain | Joseph Oriel Eaton | [Commons](https://commons.wikimedia.org/wiki/File:Herman_Melville_by_Joseph_O_Eaton.jpg) |
| Mark Twain | `twain` | `twain.jpg` (43 Ko, 320×443) | Public domain | Napoleon Sarony | [Commons](https://commons.wikimedia.org/wiki/File:Mark_Twain_Sarony.jpg) |
| Walt Whitman | `whitman` | `whitman.jpg` (32 Ko, 320×397) | Public domain | George C. Cox / Adam Cuerden | [Commons](https://commons.wikimedia.org/wiki/File:Walt_Whitman_-_George_Collins_Cox.jpg) |
| Emily Brontë | `bronte` | `bronte.jpg` (38 Ko, 320×422) | Public domain | Branwell Brontë | [Commons](https://commons.wikimedia.org/wiki/File:Emily_Bront%C3%AB_by_Patrick_Branwell_Bront%C3%AB_restored.jpg) |
| Thomas Hardy | `hardy` | `hardy.jpg` (29 Ko, 320×427) | Public domain | Bain News Service, publisher | [Commons](https://commons.wikimedia.org/wiki/File:Thomas_Hardy_Restored_Portrait_1910%E2%80%931915_(3x4_cropped).jpg) |
| Johann Wolfgang von Goethe | `goethe` | `goethe.jpg` (28 Ko, 320×395) | Public domain | Joseph Karl Stieler | [Commons](https://commons.wikimedia.org/wiki/File:Goethe_(Stieler_1828).jpg) |
| Dante Alighieri | `dante` | `dante.jpg` (41 Ko, 320×489) | Public domain | Sandro Botticelli | [Commons](https://commons.wikimedia.org/wiki/File:Portrait_de_Dante.jpg) |

## Écritures et traditions (6)

| Auteur | `id` | Fichier | Licence | Crédit (champ `Artist` de Commons) | Fiche du fichier |
| --- | --- | --- | --- | --- | --- |
| La Bible | `christianisme` | `christianisme.jpg` (20 Ko, 320×200) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | NYC Wanderer (Kevin Eng) | [Commons](https://commons.wikimedia.org/wiki/File:Gutenberg_Bible,_Lenox_Copy,_New_York_Public_Library,_2009._Pic_01.jpg) |
| La Torah | `judaisme` | `judaisme.jpg` (46 Ko, 320×436) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | HOWI - Horsch, Willy | [Commons](https://commons.wikimedia.org/wiki/File:K%C3%B6ln-Tora-und-Innenansicht-Synagoge-Glockengasse-040.JPG) |
| Le Coran | `islam` | `islam.jpg` (19 Ko, 320×165) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Mustafa-trit20 | [Commons](https://commons.wikimedia.org/wiki/File:Mamluk_era_Quran,_circa_1380,_open_to_sura_16.jpg) |
| La Bhagavad-Gîtâ | `hindouisme` | `hindouisme.jpg` (42 Ko, 320×231) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Krishna_and_Arjun_on_the_chariot,_Mahabharata,_18th-19th_century,_India.jpg) |
| Le Dhammapada | `bouddhisme` | `bouddhisme.jpg` (33 Ko, 320×208) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Folios_of_the_Bhikkhuni-patimokkha_(BL_IO_Man.Pali_21).jpg) |
| Le Tao-Tö-King | `taoisme` | `taoisme.jpg` (107 Ko, 320×706) | Public domain | Auteur inconnu | [Commons](https://commons.wikimedia.org/wiki/File:Mawangdui_LaoTsu_Ms2.JPG) |

---

Généré par un script de collecte ponctuel (hors dépôt) ; aucune modification de `app.js`, `index.html`,
`style.css`, du catalogue ni du backend.
