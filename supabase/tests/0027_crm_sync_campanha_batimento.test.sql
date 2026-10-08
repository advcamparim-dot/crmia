-- supabase/tests/0027_crm_sync_campanha_batimento.test.sql
begin;
do $t$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'crm_sync' and table_name = 'leads' and column_name = 'campaign'), 'coluna campaign existe';
  insert into crm_sync.leads (id, name, status, campaign, created_at, modified_at) values ('t-c1', 'Teste', 'New', '[MF] GESTÃO DE PASSIVO', now(), now());
  assert (select campaign from crm_sync.leads where id = 't-c1') = '[MF] GESTÃO DE PASSIVO', 'guarda a campanha';

  perform crm_sync.registrar_batimento();
  assert (select count(*) from crm_sync.sync_batimento) = 1, 'uma linha';
  assert (select executou_em from crm_sync.sync_batimento) > now() - interval '1 minute', 'batimento recente';
  update crm_sync.sync_batimento set executou_em = now() - interval '1 hour' where id = 1;
  perform crm_sync.registrar_batimento();
  assert (select count(*) from crm_sync.sync_batimento) = 1, 'segue com uma linha';
  assert (select executou_em from crm_sync.sync_batimento) > now() - interval '1 minute', 'atualiza o horario';

  assert not has_function_privilege('anon', 'crm_sync.registrar_batimento()', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'crm_sync.registrar_batimento()', 'execute'), 'authenticated sem execute';
  assert not has_table_privilege('anon', 'crm_sync.sync_batimento', 'select'), 'anon sem select';
end $t$;
rollback;
select 'OK 0027' as resultado;
