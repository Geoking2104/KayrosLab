// KayrosLab -- diagnostic de l'environnement PM2 de kayros-api apres deploiement.
//
// `pm2 jlist` peut ecrire des avertissements AVANT le JSON (ex. « >>>> In-memory PM2
// is out-of-date, do: $ pm2 update »). Les parser tels quels faisait echouer tout le
// deploiement. On extrait donc le tableau JSON de la sortie, et ce diagnostic ne fait
// jamais echouer le deploiement : il ne journalise que configured/length, jamais la valeur.

/** Extrait le tableau JSON de la sortie de `pm2 jlist`, en ignorant le bruit autour. */
export function extractJlist(output) {
  const text = String(output ?? '');
  try { const direct = JSON.parse(text); if (Array.isArray(direct)) return direct; } catch { /* bruit */ }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith('[')) continue;
    const rest = lines.slice(i).join('\n');
    const end = rest.lastIndexOf(']');
    if (end < 0) break;
    try { const parsed = JSON.parse(rest.slice(rest.indexOf('['), end + 1)); if (Array.isArray(parsed)) return parsed; } catch { /* ligne suivante */ }
  }
  return null;
}

/** Ligne de diagnostic (sans aucune valeur secrete). */
export function databaseDiagnostic(output, name = 'kayros-api') {
  const list = extractJlist(output);
  if (!list) return 'PM2 database environment: jlist illisible (diagnostic ignore)';
  const app = list.find((item) => item?.name === name);
  if (!app) return `PM2 database environment: processus ${name} introuvable`;
  const value = app.pm2_env?.DATABASE_URL || app.pm2_env?.KAYROS_DATABASE_URL || '';
  return `PM2 database environment: configured=${Boolean(value)} length=${value.length}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => { console.log(databaseDiagnostic(input)); });
}
