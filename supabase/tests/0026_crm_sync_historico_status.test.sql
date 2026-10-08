-- supabase/tests/0026_crm_sync_historico_status.test.sql
begin;
do $t$
begin
  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste', 'New', '2026-10-01 10:00+00', '2026-10-01 10:00+00');
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 1, 'criacao grava 1 linha';
  assert (select status_anterior from crm_sync.lead_historico_status where lead_id = 't-h1') is null, 'anterior nulo na criacao';
  assert (select mudou_em from crm_sync.lead_historico_status where lead_id = 't-h1') = '2026-10-01 10:00+00', 'data da criacao';

  update crm_sync.leads set status = 'New', name = 'Teste 2', modified_at = '2026-10-01 11:00+00' where id = 't-h1';
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 1, 'mesmo status nao duplica';

  update crm_sync.leads set status = 'Assigned', modified_at = '2026-10-02 09:30+00' where id = 't-h1';
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 2, 'mudanca grava';
  assert (select status_anterior || '>' || status_novo from crm_sync.lead_historico_status where lead_id = 't-h1' order by id desc limit 1) = 'New>Assigned', 'anterior e novo';
  assert (select mudou_em from crm_sync.lead_historico_status where lead_id = 't-h1' order by id desc limit 1) = '2026-10-02 09:30+00', 'usa a data do CRM';

  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste 3', 'Assigned', '2026-10-01 10:00+00', '2026-10-03 08:00+00')
    on conflict (id) do update set name = excluded.name, status = excluded.status, modified_at = excluded.modified_at;
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 2, 'upsert sem mudanca nao grava';
  insert into crm_sync.leads (id, name, status, created_at, modified_at) values ('t-h1', 'Teste 3', 'Dead', '2026-10-01 10:00+00', '2026-10-04 08:00+00')
    on conflict (id) do update set name = excluded.name, status = excluded.status, modified_at = excluded.modified_at;
  assert (select count(*) from crm_sync.lead_historico_status where lead_id = 't-h1') = 3, 'upsert com mudanca grava';

  assert not exists (select 1 from crm_sync.leads l where l.id not like 't-%' and not exists (select 1 from crm_sync.lead_historico_status h where h.lead_id = l.id)), 'todo lead existente tem ao menos uma linha';

  assert not has_table_privilege('anon', 'crm_sync.lead_historico_status', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'crm_sync.lead_historico_status', 'select'), 'authenticated sem select';
end $t$;
rollback;
select 'OK 0026' as resultado;
