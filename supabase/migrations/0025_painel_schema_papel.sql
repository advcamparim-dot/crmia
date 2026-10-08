-- supabase/migrations/0025_painel_schema_papel.sql
create schema if not exists painel;

do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'painel_leitura') then
    create role painel_leitura nologin;
  end if;
end $r$;

revoke all on schema painel from public, anon, authenticated;
grant usage on schema painel to painel_leitura;
alter default privileges in schema painel revoke all on tables from public, anon, authenticated;
