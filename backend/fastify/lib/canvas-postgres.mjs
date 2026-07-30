// KayrosLab — Backend : persistance PostgreSQL du canvas et du journal.
//
// POURQUOI ICI ET PAS DANS `core/`. Le pilote `pg` est une dependance ; le
// coeur n'en a aucune et doit tourner dans le navigateur. `core/` definit
// l'interface (`InMemoryCanvasRepository`), le backend l'implemente. C'est la
// meme frontiere que pour l'extraction PDF : le coeur decrit, le backend branche.

import { EventLog } from '../../../core/canvas/index.mjs';

/**
 * Repository PostgreSQL. Meme interface que `InMemoryCanvasRepository`, donc
 * substituable sans toucher aux appelants.
 *
 * @param {{pool: import('pg').Pool}} deps
 */
export class PostgresCanvasRepository {
  constructor({ pool }) {
    if (!pool) throw new Error('PostgresCanvasRepository: pool requis');
    this.pool = pool;
  }

  /** Texte agrege des noeuds, materialise pour l'index plein texte. */
  static _texte(ws) {
    return ws.nodes.map((n) => `${n.titre} ${n.corps ?? ''}`).join(' ').slice(0, 100000);
  }

  async save(ws) {
    const data = { ...ws, _texte: PostgresCanvasRepository._texte(ws) };
    await this.pool.query(
      `INSERT INTO canvas_workspace (id, tenant_id, nom, created_by, data, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
       ON CONFLICT (id) DO UPDATE SET
         nom = EXCLUDED.nom, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at,
         version = canvas_workspace.version + 1`,
      [ws.id, ws.tenantId ?? 'default', ws.nom, ws.createdBy, data, ws.createdAt, ws.updatedAt],
    );
    return ws;
  }

  /**
   * Ecriture avec VERROU OPTIMISTE. Si la version a bouge, on ne recrase pas :
   * on rend la main a l'appelant qui fusionnera via `reconcilier()`.
   * @returns {Promise<{ok:boolean, version?:number, conflit?:boolean}>}
   */
  async saveIfVersion(ws, version) {
    const data = { ...ws, _texte: PostgresCanvasRepository._texte(ws) };
    const r = await this.pool.query(
      `UPDATE canvas_workspace
          SET data = $1, nom = $2, updated_at = $3, version = version + 1
        WHERE id = $4 AND version = $5
      RETURNING version`,
      [data, ws.nom, ws.updatedAt, ws.id, version],
    );
    if (!r.rowCount) return { ok: false, conflit: true };
    return { ok: true, version: Number(r.rows[0].version) };
  }

  async get(id) {
    const r = await this.pool.query('SELECT data, version FROM canvas_workspace WHERE id = $1', [id]);
    if (!r.rowCount) return null;
    const { _texte, ...ws } = r.rows[0].data;
    return ws;
  }

  async getWithVersion(id) {
    const r = await this.pool.query('SELECT data, version FROM canvas_workspace WHERE id = $1', [id]);
    if (!r.rowCount) return null;
    const { _texte, ...ws } = r.rows[0].data;
    return { workspace: ws, version: Number(r.rows[0].version) };
  }

  /**
   * Suppression ORDINAIRE. Echoue si un journal existe — c'est voulu : on ne
   * supprime pas un canvas dont l'audit atteste l'activite par un simple
   * `DELETE`. Utiliser `purge()` pour un effacement assume.
   */
  async remove(id) {
    const r = await this.pool.query('DELETE FROM canvas_workspace WHERE id = $1', [id]);
    return r.rowCount > 0;
  }

  /**
   * Purge DELIBEREE : supprime le canvas ET son journal. Exige un motif, et
   * l'inscrit dans `canvas_purge_log` — l'effacement lui-meme laisse une trace.
   * Sert notamment aux demandes d'effacement de donnees personnelles.
   */
  async purge(id, { motif, par = null } = {}) {
    if (!motif) throw new Error('purge: motif requis — un effacement se justifie');
    const n = await this.pool.query('SELECT count(*)::int AS n, max(tenant_id) AS t FROM canvas_event WHERE workspace_id = $1', [id]);
    await this.pool.query("SELECT set_config('kayros.purge', 'on', false)");
    try {
      const r = await this.pool.query('DELETE FROM canvas_workspace WHERE id = $1', [id]);
      if (r.rowCount) {
        await this.pool.query(
          'INSERT INTO canvas_purge_log (workspace_id, tenant_id, evenements, motif, par) VALUES ($1,$2,$3,$4,$5)',
          [id, n.rows[0].t, n.rows[0].n, motif, par],
        );
      }
      return { supprime: r.rowCount > 0, evenements: n.rows[0].n };
    } finally {
      // Le drapeau est TOUJOURS retire, meme en cas d'echec : le laisser actif
      // ouvrirait la porte a une suppression accidentelle plus loin.
      await this.pool.query("SELECT set_config('kayros.purge', 'off', false)");
    }
  }

  async all() { return (await this.list({})); }
  async size() {
    const r = await this.pool.query('SELECT count(*)::int AS n FROM canvas_workspace');
    return r.rows[0].n;
  }

  /**
   * Le filtre tenant est applique en PREMIER et n'est jamais optionnel dans un
   * contexte authentifie : le `tenantId` vient du jeton, jamais du client.
   */
  async list({ tenantId, createdBy, q, ideaId, sort = 'updatedAt', order = 'desc' } = {}) {
    const cond = []; const args = [];
    if (tenantId) { args.push(tenantId); cond.push(`tenant_id = $${args.length}`); }
    if (createdBy) { args.push(createdBy); cond.push(`created_by = $${args.length}`); }
    if (ideaId) { args.push(JSON.stringify([ideaId])); cond.push(`data -> 'promotedIdeaIds' @> $${args.length}::jsonb`); }
    if (q) {
      args.push(q);
      cond.push(`to_tsvector('french', nom || ' ' || coalesce(data ->> '_texte','')) @@ plainto_tsquery('french', $${args.length})`);
    }
    const colonne = sort === 'createdAt' ? 'created_at' : 'updated_at';
    const sens = order === 'asc' ? 'ASC' : 'DESC';
    const r = await this.pool.query(
      `SELECT data FROM canvas_workspace
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY ${colonne} ${sens}`,
      args,
    );
    return r.rows.map(({ data }) => { const { _texte, ...ws } = data; return ws; });
  }
}

/** Journal persistant. `canvas_event` est append-only au niveau de la base. */
export class PostgresEventLog {
  constructor({ pool }) {
    if (!pool) throw new Error('PostgresEventLog: pool requis');
    this.pool = pool;
  }

  async tete(workspaceId) {
    const r = await this.pool.query(
      'SELECT hash FROM canvas_event WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1',
      [workspaceId],
    );
    return r.rowCount ? r.rows[0].hash : 'genesis';
  }

  /** Ecrit un evenement deja chaine et signe par le coeur. */
  async append(e, { tenantId = 'default' } = {}) {
    await this.pool.query(
      `INSERT INTO canvas_event (seq, workspace_id, tenant_id, type, actor_id, actor_kind, payload, ts, prev_hash, hash, sig)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.seq, e.workspaceId, tenantId, e.type, e.actorId, e.actorKind, e.payload, e.ts, e.prevHash, e.hash, e.sig ?? null],
    );
    return e;
  }

  /** Charge le journal d'un espace sous la forme attendue par le coeur. */
  async load(workspaceId) {
    const r = await this.pool.query(
      `SELECT seq, workspace_id AS "workspaceId", type, actor_id AS "actorId",
              actor_kind AS "actorKind", payload, ts, prev_hash AS "prevHash", hash, sig
         FROM canvas_event WHERE workspace_id = $1 ORDER BY seq ASC`,
      [workspaceId],
    );
    return new EventLog(r.rows.map((x) => ({
      ...x,
      seq: Number(x.seq),
      ts: x.ts instanceof Date ? x.ts.toISOString() : x.ts,
      ...(x.sig ? {} : { sig: undefined }),
    })));
  }

  /** Verifie l'integrite de la chaine persistee (EF-245). */
  async verify(workspaceId, opts = {}) {
    return (await this.load(workspaceId)).verify(opts);
  }
}

/** Registre d'agents persistant (EF-240/241). */
export class PostgresAgentRegistry {
  constructor({ pool }) { this.pool = pool; }

  async register(identite) {
    if (identite.canResolveGate) throw new Error('register: un agent ne peut pas resoudre un gate (EF-243)');
    await this.pool.query(
      `INSERT INTO canvas_agent (id, tenant_id, persona, nom, public_key, memberships, vote_weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         persona = EXCLUDED.persona, nom = EXCLUDED.nom,
         public_key = EXCLUDED.public_key, memberships = EXCLUDED.memberships,
         vote_weight = EXCLUDED.vote_weight`,
      [identite.id, identite.tenantId, identite.persona, identite.nom,
       identite.publicKey, JSON.stringify(identite.memberships), identite.voteWeight],
    );
    return identite;
  }

  async get(id) {
    const r = await this.pool.query('SELECT * FROM canvas_agent WHERE id = $1', [id]);
    if (!r.rowCount) return null;
    const a = r.rows[0];
    return {
      id: a.id, tenantId: a.tenant_id, persona: a.persona, nom: a.nom, kind: 'agent',
      publicKey: a.public_key, memberships: a.memberships, voteWeight: Number(a.vote_weight),
      canResolveGate: false, createdAt: a.created_at?.toISOString?.() ?? a.created_at,
    };
  }

  async membersOf(workspaceId, tenantId = null) {
    const args = [JSON.stringify([workspaceId])];
    let sql = `SELECT id FROM canvas_agent WHERE memberships @> $1::jsonb`;
    if (tenantId) { args.push(tenantId); sql += ` AND tenant_id = $2`; }
    const r = await this.pool.query(sql, args);
    return Promise.all(r.rows.map((x) => this.get(x.id)));
  }

  async join(agentId, workspaceId) {
    await this.pool.query(
      `UPDATE canvas_agent
          SET memberships = CASE WHEN memberships @> $2::jsonb THEN memberships
                                 ELSE memberships || $2::jsonb END
        WHERE id = $1`,
      [agentId, JSON.stringify([workspaceId])],
    );
    return this.get(agentId);
  }

  async leave(agentId, workspaceId) {
    await this.pool.query(
      `UPDATE canvas_agent SET memberships = memberships - $2 WHERE id = $1`,
      [agentId, workspaceId],
    );
    return this.get(agentId);
  }
}
