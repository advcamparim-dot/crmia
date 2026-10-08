-- supabase/tests/0025_painel_schema_papel.test.sql
begin;
do $t$
begin
  assert exists (select 1 from pg_namespace where nspname = 'painel'), 'schema painel existe';
  assert exists (select 1 from pg_roles where rolname = 'painel_leitura'), 'papel existe';
  assert not (select rolcanlogin from pg_roles where rolname = 'painel_leitura'), 'papel nasce sem login';
  assert has_schema_privilege('painel_leitura', 'painel', 'usage'), 'usage no schema painel';
  assert not has_schema_privilege('painel_leitura', 'crm_sync', 'usage'), 'sem acesso a crm_sync';
  assert not has_schema_privilege('painel_leitura', 'mayara', 'usage'), 'sem acesso a mayara';
  assert not has_table_privilege('painel_leitura', 'crm_sync.leads', 'select'), 'nao le crm_sync.leads';
end $t$;
rollback;
select 'OK 0025' as resultado;
