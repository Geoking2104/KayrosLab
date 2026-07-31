-- KayrosLab Postgres schema (I)
-- Apply: psql $DATABASE_URL -f core/sql/schema.sql

create table if not exists kayros_ideas (
  id text primary key,
  tenant_id text not null default 'default',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists kayros_ideas_tenant on kayros_ideas (tenant_id);
create index if not exists kayros_ideas_status on kayros_ideas ((payload->>'status'));

create table if not exists kayros_gates_pending (
  gate_id text primary key,
  payload jsonb not null
);

create table if not exists kayros_gates_history (
  id bigserial primary key,
  gate_id text not null,
  payload jsonb not null,
  resolved_at timestamptz not null default now()
);

create index if not exists kayros_gates_history_gate on kayros_gates_history (gate_id);
