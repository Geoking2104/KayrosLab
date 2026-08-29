begin;

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
create index if not exists kayros_decision_threads_tenant on kayros_decision_threads (tenant_id, updated_at desc);
create index if not exists kayros_decision_threads_room on kayros_decision_threads (tenant_id, room_id, updated_at desc);

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
create index if not exists kayros_decision_thread_messages_stream on kayros_decision_thread_messages (tenant_id, thread_id, message_id);

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

commit;
