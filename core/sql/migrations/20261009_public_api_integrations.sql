-- Migration 2026-10-09 : API publique, clés d’API, webhooks signés, file de missions.
-- Identique au bloc correspondant de core/sql/schema.sql (appliqué au démarrage).
-- Idempotente : uniquement des `create … if not exists`, aucune table existante modifiée.
-- Intégrations (API publique /v1/public/*, webhooks signés, file de missions).
-- Voir docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md. Tables nouvelles uniquement,
-- en `if not exists` : réappliquer ce schéma au démarrage est sans effet sur
-- les données existantes.
create table if not exists kayros_api_keys (
  key_id text primary key,
  tenant_id text not null,
  name text not null,
  prefix text not null unique,
  token_sha256 text not null unique,
  scopes text[] not null default '{}',
  service_account text not null default 'integration',
  collective_ids text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists kayros_api_keys_tenant on kayros_api_keys (tenant_id, created_at desc);

create table if not exists kayros_public_missions (
  mission_id text primary key,
  tenant_id text not null,
  key_id text,
  idempotency_key text,
  request_sha256 text,
  thread_id text,
  room_id text not null,
  profile text not null default 'fast',
  external_system text,
  external_object text,
  external_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists kayros_public_missions_idempotency
  on kayros_public_missions (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists kayros_public_missions_external
  on kayros_public_missions (tenant_id, external_system, external_id, created_at desc);
create index if not exists kayros_public_missions_thread on kayros_public_missions (thread_id);
create index if not exists kayros_public_missions_recent on kayros_public_missions (tenant_id, created_at desc);

create table if not exists kayros_integration_settings (
  tenant_id text primary key,
  webhook_url text,
  webhook_secret text,
  events text[] not null default '{mission.completed,mission.failed,mission.arbitrated}',
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists kayros_webhook_deliveries (
  delivery_id text primary key,
  tenant_id text not null,
  event_id text not null,
  event_type text not null,
  mission_id text,
  target_url text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  locked_by text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (event_id, target_url)
);
create index if not exists kayros_webhook_deliveries_due
  on kayros_webhook_deliveries (next_attempt_at) where status in ('pending', 'delivering');
create index if not exists kayros_webhook_deliveries_tenant on kayros_webhook_deliveries (tenant_id, created_at desc);

create table if not exists kayros_mission_jobs (
  job_id text primary key,
  tenant_id text not null,
  thread_id text not null,
  run_id text not null,
  kind text not null,
  spec jsonb not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  locked_by text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists kayros_mission_jobs_ready
  on kayros_mission_jobs (created_at) where status in ('queued', 'running');
create index if not exists kayros_mission_jobs_thread on kayros_mission_jobs (thread_id);
