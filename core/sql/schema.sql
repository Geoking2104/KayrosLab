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
