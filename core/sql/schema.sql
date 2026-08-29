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

-- Hybrid collaboration console — shared state for horizontally scaled nodes.
create table if not exists kayros_swarm_agents (
  tenant_id text not null default 'default',
  agent_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, agent_id)
);

create table if not exists kayros_swarm_configurations (
  tenant_id text not null default 'default',
  swarm_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, swarm_id)
);

create table if not exists kayros_swarm_runs (
  tenant_id text not null default 'default',
  run_id text not null,
  swarm_id text not null,
  status text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, run_id)
);

create index if not exists kayros_swarm_runs_pending
  on kayros_swarm_runs (tenant_id, updated_at desc)
  where status = 'pending_human_arbitration';

create table if not exists kayros_collaboration_rooms (
  room_id text primary key,
  tenant_id text not null default 'default',
  platform text not null,
  external_room_id text not null,
  status text not null default 'active',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_room_id)
);

create index if not exists kayros_collaboration_rooms_tenant
  on kayros_collaboration_rooms (tenant_id, updated_at desc);

create table if not exists kayros_collaboration_events (
  sequence bigserial primary key,
  tenant_id text not null default 'default',
  room_id text,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists kayros_collaboration_events_stream
  on kayros_collaboration_events (tenant_id, sequence desc);
create index if not exists kayros_collaboration_events_room
  on kayros_collaboration_events (tenant_id, room_id, sequence desc);

-- A claim absorbs webhook retries across processes. Expired processing claims
-- can be taken over by another node after a crash.
create table if not exists kayros_collaboration_messages (
  platform text not null,
  message_id text not null,
  tenant_id text not null default 'default',
  room_id text not null,
  status text not null default 'processing',
  lease_until timestamptz not null,
  result jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, platform, message_id)
);

create index if not exists kayros_collaboration_messages_expiry
  on kayros_collaboration_messages (lease_until)
  where status = 'processing';

-- Production console v2 — durable decision conversations and encrypted,
-- tenant-scoped connector configuration. Secret ciphertext is opaque to SQL;
-- encryption/decryption only happens in the Fastify process.
create table if not exists kayros_decision_threads (
  thread_id text primary key,
  tenant_id text not null default 'default',
  room_id text not null references kayros_collaboration_rooms(room_id) on delete cascade,
  root_run_id text,
  current_run_id text,
  status text not null,
  question text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kayros_decision_threads_tenant
  on kayros_decision_threads (tenant_id, updated_at desc);
create index if not exists kayros_decision_threads_room
  on kayros_decision_threads (tenant_id, room_id, updated_at desc);

create table if not exists kayros_decision_thread_messages (
  message_id bigserial primary key,
  thread_id text not null references kayros_decision_threads(thread_id) on delete cascade,
  tenant_id text not null default 'default',
  role text not null,
  kind text not null,
  author_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists kayros_decision_thread_messages_stream
  on kayros_decision_thread_messages (tenant_id, thread_id, message_id);

create table if not exists kayros_connector_configurations (
  tenant_id text not null default 'default',
  platform text not null,
  connection_id text not null,
  enabled boolean not null default false,
  status text not null default 'not_configured',
  settings jsonb not null default '{}'::jsonb,
  encrypted_secrets text,
  secret_fingerprint text,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, platform),
  unique (connection_id)
);

-- Sales Oracle MVP — tenant-scoped cases, document metadata and ingestion jobs.
-- Raw file bytes live in S3-compatible object storage, never in Postgres.
create table if not exists sales_oracle_cases (
  case_id text primary key,
  tenant_id text not null,
  name text not null,
  use_case text not null,
  decision_question text not null,
  client_reference text,
  committee_date timestamptz,
  status text not null,
  corpus_version integer not null default 1,
  retention_until timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, case_id)
);

create index if not exists sales_oracle_cases_tenant_updated on sales_oracle_cases (tenant_id, updated_at desc);
create index if not exists sales_oracle_cases_tenant_status on sales_oracle_cases (tenant_id, status);

create table if not exists sales_oracle_documents (
  document_id text primary key,
  tenant_id text not null,
  case_id text not null references sales_oracle_cases(case_id) on delete cascade,
  source_type text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  object_key text not null,
  sensitivity text not null default 'confidential',
  status text not null,
  language text,
  page_count integer,
  extraction_error text,
  storage_etag text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  deleted_at timestamptz,
  unique (tenant_id, document_id),
  unique (tenant_id, case_id, sha256)
);

create index if not exists sales_oracle_documents_case on sales_oracle_documents (tenant_id, case_id, uploaded_at desc);
create index if not exists sales_oracle_documents_status on sales_oracle_documents (tenant_id, status);

create table if not exists sales_oracle_ingestion_jobs (
  job_id text primary key,
  tenant_id text not null,
  document_id text not null references sales_oracle_documents(document_id) on delete cascade,
  job_type text not null,
  status text not null,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, job_id)
);

create index if not exists sales_oracle_jobs_ready on sales_oracle_ingestion_jobs (status, available_at) where status = 'queued';
create index if not exists sales_oracle_jobs_tenant on sales_oracle_ingestion_jobs (tenant_id, created_at desc);

-- TimesFM 2.5 — tenant-scoped KPI history and latest forecast snapshots.
-- The model output remains a simulation and is never mixed with observed KPI
-- readings. Reapplying this schema is safe on every backend start.
create table if not exists kayros_kpi_history (
  id bigserial primary key,
  tenant_id text not null default 'default',
  idea_id text not null,
  kpi text not null,
  ts timestamptz not null default now(),
  value double precision not null,
  source text not null default 'monitor'
);

create index if not exists kayros_kpi_history_lookup
  on kayros_kpi_history (tenant_id, idea_id, kpi, ts desc, id desc);

create table if not exists kayros_forecasts (
  tenant_id text not null default 'default',
  idea_id text not null,
  kpi text not null default 'impact_score',
  horizon integer not null check (horizon between 1 and 1000),
  point_forecast jsonb not null,
  quantile_forecast jsonb not null,
  model_id text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, idea_id, kpi, horizon)
);

create index if not exists kayros_forecasts_recent
  on kayros_forecasts (tenant_id, idea_id, updated_at desc);
