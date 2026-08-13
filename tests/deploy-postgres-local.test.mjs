// KayrosLab -- provisionnement Postgres local sur le VPS.
//
// Ce script tourne en root sur une machine a laquelle je n'ai pas acces : je ne
// peux pas l'executer. Ces tests encodent donc ses proprietes non negociables,
// pour qu'une modification future ne les perde pas en silence -- en particulier
// celles qui touchent au mot de passe.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SETUP = new URL('../deploy/ovh-vps/setup-postgres-local.sh', import.meta.url);
const DEPLOY = new URL('../deploy/ovh-vps/deploy-backend.sh', import.meta.url);
const WORKFLOW = new URL('../.github/workflows/deploy-vps-backend.yml', import.meta.url);

const read = (u) => readFile(u, 'utf8');

test('le mot de passe n’est jamais affiche ni journalise', async () => {
  const sh = await read(SETUP);
  // Le log de deploiement est lisible par quiconque a acces aux Actions.
  const echoes = sh.split('\n').filter((l) => /^\s*echo /.test(l));
  for (const line of echoes) {
    assert.equal(/\$\{?PG_PASS\}?/.test(line), false, `mot de passe dans un echo : ${line.trim()}`);
    assert.equal(/\$\{?DB_URL\}?/.test(line), false, `URL complete dans un echo : ${line.trim()}`);
  }
  // La confirmation affiche une forme masquee.
  assert.match(sh, /postgres:\/\/\$\{PG_USER\}:\*\*\*@/, 'la confirmation masque le mot de passe');
});

test('le mot de passe ne passe pas par la ligne de commande', async () => {
  const sh = await read(SETUP);
  // Un mot de passe en argument est lisible dans /proc et dans l'historique.
  assert.equal(/psql .*-c .*password '\$\{PG_PASS\}/.test(sh), false);
  assert.match(sh, /mktemp/, 'le SQL sensible passe par un fichier temporaire');
  assert.match(sh, /chmod 600 "\$\{tmp_sql\}"/, 'le fichier temporaire est prive');
  assert.match(sh, /shred -u|rm -f "\$\{tmp_sql\}"/, 'et il est efface ensuite');
});

test('le .env reste prive', async () => {
  const sh = await read(SETUP);
  assert.match(sh, /chmod 600 "\$\{ENV_FILE\}"/, 'le .env porte le mot de passe : mode 600');
});

test('une DATABASE_URL existante n’est jamais ecrasee', async () => {
  const sh = await read(SETUP);
  // Remplacer silencieusement la base ferait disparaitre les runs en attente
  // de decision humaine.
  assert.match(sh, /if grep -qE '\^DATABASE_URL=\.\+' "\$\{ENV_FILE\}"; then/);
  assert.match(sh, /provisionnement local ignore/i, 'une base distante est respectee');
  assert.match(sh, /rien a faire/i, 'une base locale deja configuree est respectee');
});

test('rejouer le script ne casse pas un backend en service', async () => {
  const sh = await read(SETUP);
  // Le mot de passe n'est genere que si le role n'existe pas : le regenerer
  // invaliderait la DATABASE_URL deja ecrite.
  assert.match(sh, /select 1 from pg_roles where rolname/, 'existence du role verifiee');
  assert.match(sh, /select 1 from pg_database where datname/, 'existence de la base verifiee');
  const genIndex = sh.indexOf('PG_PASS=$(openssl');
  const guardIndex = sh.indexOf('if [[ "${role_exists}" != "1" ]]');
  assert.ok(guardIndex > 0 && genIndex > guardIndex, 'la generation est sous la garde d’existence');
});

test('un role orphelin est signale plutot que contourne', async () => {
  const sh = await read(SETUP);
  // Role present mais .env sans URL : le script ne peut pas deviner le mot de
  // passe. Il doit le dire et s'arreter, pas en fabriquer un nouveau.
  assert.match(sh, /existe deja mais \.env n'a pas de DATABASE_URL/);
  assert.match(sh, /alter role \$\{PG_USER\} with password/, 'la sortie donne la commande de secours');
});

test('le script attend que Postgres reponde avant de continuer', async () => {
  const sh = await read(SETUP);
  // Le paquet Debian demarre le cluster, mais pas instantanement : sans
  // attente, l'echec ressemblerait a un probleme de droits.
  assert.match(sh, /systemctl enable --now postgresql/);
  assert.match(sh, /for _ in \$\(seq 1 20\)/, 'attente bornee');
  assert.match(sh, /ne repond pas apres installation/, 'echec explicite si absent');
});

test('la base ecoute uniquement en local', async () => {
  const sh = await read(SETUP);
  assert.match(sh, /PG_HOST="127\.0\.0\.1"/, 'aucune exposition reseau');
  assert.equal(/listen_addresses\s*=\s*'\*'/.test(sh), false, 'jamais d’ouverture sur toutes les interfaces');
});

test('le deploiement appelle le provisionnement sans le rendre fatal', async () => {
  const deploy = await read(DEPLOY);
  assert.match(deploy, /KAYROS_LOCAL_PG:-0/, 'opt-in explicite');
  assert.match(deploy, /setup-postgres-local\.sh/);
  // Un provisionnement rate ne doit pas empecher le backend de demarrer sur
  // le store fichier.
  assert.match(deploy, /provisionnement Postgres local en echec/);
  // L'ordre compte : provisionner avant de lire DATABASE_URL pour le schema.
  assert.ok(
    deploy.indexOf('setup-postgres-local.sh') < deploy.indexOf('DB_URL=""'),
    'le provisionnement precede la lecture de DATABASE_URL',
  );
});

test('le workflow active le mode local et ne transporte aucun mot de passe', async () => {
  const wf = await read(WORKFLOW);
  assert.match(wf, /KAYROS_LOCAL_PG=1 bash deploy\/ovh-vps\/deploy-backend\.sh/);
  // DATABASE_URL reste un override optionnel : absent, rien n'est ecrit.
  assert.match(wf, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(wf, /DATABASE_URL: process\.env\.DATABASE_URL/);
  assert.ok(
    wf.indexOf('const optionalSources') < wf.indexOf('DATABASE_URL: process.env.DATABASE_URL'),
    'DATABASE_URL est optionnel : une valeur vide ne doit pas etre ecrite',
  );
});
