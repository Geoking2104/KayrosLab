-- Base et rôle dédiés à n8n dans le Postgres local du VPS (isolés de la base
-- KayrosLab : n8n n'a aucun droit sur les tables kayros_*).
--
--   sudo -u postgres psql -v n8n_password='MOT_DE_PASSE' -f init-n8n-db.sql
--
-- Idempotent : peut être rejoué (ne change que le mot de passe).
select format('create role n8n login password %L', :'n8n_password')
where not exists (select 1 from pg_roles where rolname = 'n8n') \gexec
select format('alter role n8n login password %L', :'n8n_password') \gexec
select 'create database n8n owner n8n'
where not exists (select 1 from pg_database where datname = 'n8n') \gexec
revoke all on database n8n from public;
grant all privileges on database n8n to n8n;
