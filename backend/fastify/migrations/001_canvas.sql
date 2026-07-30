-- KayrosLab — Migration v12 : persistance partagee du canvas et du journal.
-- Resout la partielle EF-46 (persistance fichiers -> base partagee multi-instance)
-- et debloque EF-220 (collaboration temps reel) et EF-244 (journal chaine).
--
-- Choix : JSONB pour le contenu du canvas, colonnes dediees pour ce sur quoi on
-- filtre. Normaliser noeuds et aretes en tables couterait des jointures a chaque
-- lecture pour un gain nul : un canvas est toujours charge en entier.

CREATE TABLE IF NOT EXISTS canvas_workspace (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  nom           TEXT NOT NULL,
  created_by    TEXT,
  data          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Verrou optimiste : deux instances qui ecrivent en concurrence ne doivent
  -- pas se perdre silencieusement (cf. reconciliation dans core/canvas/sync.mjs).
  version       BIGINT NOT NULL DEFAULT 1
);

-- L'isolation multi-tenant est un filtre de PREMIER rang (EF-48 / EF-206).
CREATE INDEX IF NOT EXISTS idx_canvas_tenant     ON canvas_workspace (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_promoted   ON canvas_workspace USING GIN ((data -> 'promotedIdeaIds'));
-- Recherche plein texte sur le contenu des noeuds (EF-222 / EF-252).
CREATE INDEX IF NOT EXISTS idx_canvas_recherche  ON canvas_workspace
  USING GIN (to_tsvector('french', nom || ' ' || coalesce(data ->> '_texte', '')));

CREATE TABLE IF NOT EXISTS canvas_event (
  seq           BIGINT NOT NULL,
  workspace_id  TEXT NOT NULL REFERENCES canvas_workspace(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  type          TEXT NOT NULL,
  actor_id      TEXT,
  actor_kind    TEXT NOT NULL DEFAULT 'human',
  payload       JSONB NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL,
  sig           TEXT,
  PRIMARY KEY (workspace_id, seq)
);

-- Un hash doit etre unique : deux evenements de meme empreinte signaleraient
-- soit un rejeu, soit une collision — dans les deux cas il faut le savoir.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_hash ON canvas_event (hash);
CREATE INDEX IF NOT EXISTS idx_event_ws_seq      ON canvas_event (workspace_id, seq);
CREATE INDEX IF NOT EXISTS idx_event_acteur      ON canvas_event (actor_id, ts DESC);

-- Le journal est APPEND-ONLY : la regle est posee dans la base, pas seulement
-- dans le code applicatif. Un audit qu'un UPDATE peut reecrire n'est pas un audit.
--
-- EXCEPTION NECESSAIRE — decouverte en recette. Un trigger qui refuse tout
-- DELETE bloque aussi le ON DELETE CASCADE : un canvas ayant un journal
-- devenait indestructible, y compris pour une demande legitime d'effacement.
-- La purge reste donc possible mais doit etre DELIBEREE : elle exige de poser
-- `kayros.purge` dans la session. Une suppression accidentelle echoue toujours ;
-- une purge assumee passe, et laisse une trace dans `canvas_purge_log`.
CREATE OR REPLACE FUNCTION canvas_event_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('kayros.purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'canvas_event est append-only (tentative de % refusee)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS canvas_purge_log (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tenant_id    TEXT,
  evenements   INTEGER NOT NULL,
  motif        TEXT NOT NULL,
  par          TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_canvas_event_immuable ON canvas_event;
CREATE TRIGGER trg_canvas_event_immuable
  BEFORE UPDATE OR DELETE ON canvas_event
  FOR EACH ROW EXECUTE FUNCTION canvas_event_append_only();

CREATE TABLE IF NOT EXISTS canvas_agent (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  persona       TEXT NOT NULL,
  nom           TEXT,
  public_key    TEXT NOT NULL,
  memberships   JSONB NOT NULL DEFAULT '[]'::jsonb,
  vote_weight   NUMERIC NOT NULL DEFAULT 1,
  -- EF-243 grave dans le schema : aucune ligne ne peut affirmer le contraire.
  can_resolve_gate BOOLEAN NOT NULL DEFAULT false CHECK (can_resolve_gate = false),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tenant ON canvas_agent (tenant_id);
