-- supabase/tests/0020_indice_envios_message_id.test.sql
-- Rodar inteiro (execute_sql).
do $t$ begin
  assert exists (select 1 from pg_indexes where schemaname = 'mayara' and tablename = 'envios_log' and indexdef ilike '%(provedor_message_id)%'), 'falta indice em envios_log.provedor_message_id';
end $t$;
select 'OK 0020' as resultado;
