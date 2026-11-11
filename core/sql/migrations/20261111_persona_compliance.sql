-- Migration 2026-11-11 : conformité des agents personnifiés (cahier des charges v4, phase 1).
-- Identique au bloc correspondant de core/sql/schema.sql (appliqué au démarrage).
-- Idempotente : uniquement des `create … if not exists`, aucune table existante modifiée ni supprimée.
-- Tables posées pour les phases suivantes (DPA du tenant, demandes publiques, liste de blocage) ;
-- aucune lecture ni écriture tant que KAYROS_PERSONA_PUBLIC_MODEL n'est pas activé.
create table if not exists kayros_tenant_compliance (
  tenant_id text primary key,
  dpa_version text,
  dpa_signed_at timestamptz,
  dpa_signed_by text,
  lia_version text,
  lia_validated_at timestamptz,
  lia_validated_by text,
  privacy_notice_url text,
  notice_attested_at timestamptz,
  notice_attested_by text,
  portrait_photos_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists kayros_persona_privacy_requests (
  request_id text primary key,
  tenant_id text,
  kind text not null default 'objection',
  subject_name text,
  subject_email_sha256 text,
  subject_profile_url text,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '1 month'),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists kayros_persona_privacy_requests_due
  on kayros_persona_privacy_requests (due_at) where status <> 'resolved';

create table if not exists kayros_persona_blocklist (
  entry_id text primary key,
  identifier_sha256 text not null unique,
  identifier_kind text not null,
  request_id text,
  created_at timestamptz not null default now()
);
