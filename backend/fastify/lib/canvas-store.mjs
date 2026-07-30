// KayrosLab — Selection de la persistance du canvas.
//
// Deux paliers, une seule interface :
//   - sans `DATABASE_URL` : fichiers JSON (mono-serveur, palier actuel) ;
//   - avec `DATABASE_URL`  : PostgreSQL partage (multi-instance, resout EF-46).
//
// La bascule est un changement de variable d'environnement, pas de code : c'est
// ce que permet l'abstraction `InMemoryCanvasRepository` definie dans le coeur.

import { FileCanvasRepository, EventLog } from '../../../core/canvas/index.mjs';
import { PostgresCanvasRepository, PostgresEventLog, PostgresAgentRegistry } from './canvas-postgres.mjs';

/**
 * Journal sur fichier — repli quand PostgreSQL n'est pas configure.
 * Meme surface que `PostgresEventLog` : les routes ne savent pas lequel elles ont.
 */
class FileEventLog {
  constructor({ path, fs = null }) { this.path = path; this._fs = fs; }
  async _mod() { return this._fs ?? (await import('node:fs/promises')); }

  async _lire() {
    const fs = await this._mod();
    try {
      const brut = await fs.readFile(this.path, 'utf8');
      return brut.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch { return []; }
  }
  async tete(workspaceId) {
    const e = (await this._lire()).filter((x) => x.workspaceId === workspaceId);
    return e.at(-1)?.hash ?? 'genesis';
  }
  async append(e) {
    const fs = await this._mod();
    // Append atomique ligne a ligne : un journal ne se reecrit pas.
    await fs.appendFile(this.path, `${JSON.stringify(e)}\n`, 'utf8');
    return e;
  }
  async load(workspaceId) {
    return new EventLog((await this._lire()).filter((x) => x.workspaceId === workspaceId));
  }
  async verify(workspaceId, opts = {}) { return (await this.load(workspaceId)).verify(opts); }
}

/**
 * Construit la couche de persistance du canvas.
 * @returns {Promise<{repo:object, journal:object, agents:object|null, pool:object|null, mode:string}>}
 */
export async function buildCanvasStore(env = process.env, { pool: injecte = null } = {}) {
  const url = env.DATABASE_URL;

  // Pool injecte : sert a rejouer la recette VPS contre un moteur embarque
  // avant de la lancer sur le serveur. Aucun effet en production.
  if (injecte) {
    const t = await injecte.query('SELECT current_database() AS db, version() AS v');
    return {
      repo: new PostgresCanvasRepository({ pool: injecte }),
      journal: new PostgresEventLog({ pool: injecte }),
      agents: new PostgresAgentRegistry({ pool: injecte }),
      pool: injecte, mode: 'postgres',
      info: { base: t.rows[0].db, version: t.rows[0].v.split(',')[0] },
    };
  }

  if (!url) {
    const chemin = env.KAYROS_CANVAS_FILE || '/opt/kayroslab/data/canvas.json';
    const repo = await new FileCanvasRepository({ path: chemin }).load();
    return {
      repo,
      journal: new FileEventLog({ path: env.KAYROS_JOURNAL_FILE || '/opt/kayroslab/data/journal.jsonl' }),
      agents: null,
      pool: null,
      mode: 'fichiers',
    };
  }

  // Import dynamique : `pg` n'est charge que si la base est reellement utilisee.
  // Le backend reste demarrable sans le pilote installe.
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // TLS uniquement si l'on sort de la machine. En local (127.0.0.1) il
    // n'apporte rien et complique le deploiement sans reduire le risque.
    ssl: /(^|@)(?!127\.0\.0\.1|localhost)/.test(url) && env.PGSSL !== 'off' ? { rejectUnauthorized: false } : false,
  });

  // Echec RAPIDE et explicite : un backend qui demarre avec une base
  // injoignable bascule silencieusement en erreur a la premiere requete.
  const t = await pool.query('SELECT current_database() AS db, version() AS v');

  return {
    repo: new PostgresCanvasRepository({ pool }),
    journal: new PostgresEventLog({ pool }),
    agents: new PostgresAgentRegistry({ pool }),
    pool,
    mode: 'postgres',
    info: { base: t.rows[0].db, version: t.rows[0].v.split(',')[0] },
  };
}
