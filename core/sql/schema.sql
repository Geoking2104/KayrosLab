-- KayrosLab Postgres schema — multi-instance safe
-- Apply: psql "$DATABASE_URL" -f core/sql/schema.sql

create table if not exists kayros_ideas (
  id text primary key,
  tenant_id text not null default 'default',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists kayros_ideas_tenant on kayros_ideas (tenant_id);
create index if not exists kayros_ideas_status on kayros_ideas ((payload->>'status'));
create index if not exists kayros_ideas_stage on kayros_ideas ((payload->>'stage'));
create index if not exists kayros_ideas_updated on kayros_ideas (updated_at desc);

create table if not exists kayros_gates_pending (
  gate_id text primary key,
  tenant_id text not null default 'default',
  payload jsonb not null
);

create index if not exists kayros_gates_pending_tenant on kayros_gates_pending (tenant_id);

create table if not exists kayros_gates_history (
  id bigserial primary key,
  gate_id text not null,
  tenant_id text not null default 'default',
  payload jsonb not null,
  resolved_at timestamptz not null default now()
);

create index if not exists kayros_gates_history_gate on kayros_gates_history (gate_id);
create index if not exists kayros_gates_history_tenant on kayros_gates_history (tenant_id);

-- v14 — Slack/Teams account links
create table if not exists kayros_account_links (
  platform_id text primary key,
  tenant_id text not null default 'default',
  payload jsonb not null,
  linked_at timestamptz not null default now()
);

create index if not exists kayros_account_links_tenant on kayros_account_links (tenant_id);

-- Runs suspendus sur un gate humain. Un fichier suppose un seul processus
-- ecrivain ; des deux instances derriere un load balancer, les ecritures se
-- perdent. La table est la source de verite partagee.
create table if not exists kayros_runs_suspended (
  run_id text primary key,
  tenant_id text not null default 'default',
  idea_id text,
  status text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists kayros_runs_suspended_tenant on kayros_runs_suspended (tenant_id);
create index if not exists kayros_runs_suspended_idea on kayros_runs_suspended (idea_id);
create index if not exists kayros_runs_suspended_updated on kayros_runs_suspended (updated_at desc);
