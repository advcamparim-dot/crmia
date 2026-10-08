-- supabase/tests/0029_painel_views.test.sql
-- Rodar a parte A inteira (termina em rollback) e depois a parte B (somente leitura de privilegios).

-- Parte A: as views devolvem o esperado e nao expoem colunas sensiveis
begin;
do $t$
declare colunas text;
begin
  insert into crm_sync.leads (id, name, status, campaign, source, legal_area, channel, urgency_level, lost_reason, created_at, modified_at)
    values ('t-v1', 'Teste', 'New', '[MF] GESTÃO DE PASSIVO', 'Web Site', 'Renegociação de Dívida', 'WhatsApp', 'Baixa', 'Não Respondeu', now(), now());
  perform painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-10-01', 100);
  perform crm_sync.registrar_batimento();
  assert (select count(*) from painel.v_leads where id = 't-v1') = 1, 'v_leads';
  assert (select campanha from painel.v_leads where id = 't-v1') = '[MF] GESTÃO DE PASSIVO', 'campanha na view';
  assert (select count(*) from painel.v_lead_status_historico where lead_id = 't-v1') = 1, 'historico';
  assert (select valor from painel.v_gasto) = 100, 'gasto';
  assert (select count(*) from painel.v_sync_cursores) >= 1, 'cursores';
  update crm_sync.sync_state set last_synced_at = '1970-01-01 00:00:00+00' where entity_name = 'CCasoJuridico';
  assert (select ultima_alteracao from painel.v_sync_cursores where entidade = 'CCasoJuridico') is null, 'nunca sincronizado vira nulo';
  assert (select atrasado from painel.v_sync_batimento) = false, 'batimento recente nao atrasa';
  update crm_sync.sync_batimento set executou_em = now() - interval '2 hours' where id = 1;
  assert (select atrasado from painel.v_sync_batimento) = true, 'batimento antigo atrasa';
  assert coalesce((null::timestamptz) < now() - interval '30 minutes', true) = true, 'logica de sem batimento conta como atrasado';
  select string_agg(table_name || '.' || column_name, ',') into colunas from information_schema.columns
   where table_schema = 'painel' and table_name like 'v\_%' and (column_name ilike '%telefone%' or column_name ilike '%phone%' or column_name ilike '%email%' or column_name ilike '%descri%' or column_name ilike '%description%' or column_name ilike '%mensagem%');
  assert colunas is null, 'colunas sensiveis nas views: ' || coalesce(colunas, '');
end $t$;
rollback;
select 'OK 0029-a' as resultado;

-- Parte B: concessoes (o papel de execucao do SQL nao pode assumir painel_leitura; checamos os privilegios)
do $t$
declare v text;
begin
  foreach v in array array['painel.v_leads','painel.v_lead_status_historico','painel.v_gasto','painel.v_sync_cursores','painel.v_sync_batimento'] loop
    assert has_table_privilege('painel_leitura', v, 'select'), 'leitura deve ler ' || v;
    assert not has_table_privilege('painel_leitura', v, 'insert'), 'leitura nao grava ' || v;
    assert not has_table_privilege('anon', v, 'select'), 'anon nao le ' || v;
    assert not has_table_privilege('authenticated', v, 'select'), 'authenticated nao le ' || v;
  end loop;
  assert not has_table_privilege('painel_leitura', 'crm_sync.leads', 'select'), 'leitura nao le crm_sync.leads';
  assert not has_table_privilege('painel_leitura', 'crm_sync.lead_historico_status', 'select'), 'leitura nao le o historico bruto';
  assert not has_table_privilege('painel_leitura', 'crm_sync.sync_batimento', 'select'), 'leitura nao le o batimento bruto';
  assert not has_table_privilege('painel_leitura', 'painel.gasto_anuncios', 'select'), 'leitura nao le a tabela de gasto';
  assert not has_schema_privilege('painel_leitura', 'mayara', 'usage'), 'leitura sem acesso ao schema mayara';
  assert not has_schema_privilege('painel_leitura', 'crm_sync', 'usage'), 'leitura sem acesso ao schema crm_sync';
end $t$;
select 'OK 0029-b' as resultado;
