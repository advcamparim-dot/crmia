-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999989xxx); termina em rollback.
begin;
do $t$
declare
  hoje date := painel._hoje(); k1 text := mayara.chave_telefone('+5511999989001'); n int; r record;
begin
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone) values
    ('V-1', 'Contratou RealizadaCRM', 'Consulta Realizada', now(), now(), '+5511999989001'),
    ('V-2', 'Contratou Dead', 'Dead', now(), now(), '+5511999989002'),
    ('V-3', 'Contratou Fora da Lista', 'New', now(), now(), '+5511999989003'),
    ('V-4', 'Sem Contrato', 'New', now(), now(), '+5511999989004'),
    ('V-5', 'Ja Convertido', 'Converted', now(), now(), '+5511999989005');
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id, status) values
    ('+5511999989001', 'Contratou', 'x', 'V-1', 'bloqueado'), ('+5511999989002', 'Dead', 'x', 'V-2', 'sem_interesse'),
    ('+5511999989004', 'Sem Contrato', 'x', 'V-4', 'ativo'), ('+5511999989005', 'Convertido', 'x', 'V-5', 'ativo');
  update mayara.config set valor = 'ligado' where chave = 'crm_funil_modo';

  perform painel.contrato_registrar('+5511999989001', 'Contratou', 'V-1', 1000, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', hoje + 30)));
  perform painel.contrato_registrar('+5511999989002', 'Dead', 'V-2', 1000, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', hoje + 30)));
  perform painel.contrato_registrar('+5511999989003', 'Fora da Lista', 'V-3', 1000, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', hoje + 30)));
  perform painel.contrato_registrar('+5511999989005', 'Convertido', 'V-5', 1000, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 1000, 'vencimento', hoje + 30)));

  assert (select status_novo from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-1') = 'Converted', 'contrato: Consulta Realizada vira Converted';
  assert (select status_atual from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-1') = 'Consulta Realizada', 'estado atual informado';
  assert not exists (select 1 from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-2'), 'Dead com contrato nao e tocado';
  assert (select status_novo from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-3') = 'Converted', 'cliente com contrato fora da lista, mas no CRM, tambem vira Converted';
  assert not exists (select 1 from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-4'), 'sem contrato e sem sinal: nada';
  assert not exists (select 1 from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-5'), 'ja Converted: nada';
  perform mayara.crm_status_registrar('V-1', 'Converted', true, null);
  assert not exists (select 1 from mayara.crm_status_pendentes(500) where crm_lead_id = 'V-1'), 'aplicado uma vez nao repete';

  -- eventos e funil
  n := painel.eventos_atualizar();
  assert (select count(*) from painel.eventos where lead_chave = k1 and tipo = 'contrato_fechado') = 1, 'evento contrato_fechado criado';
  assert (select count(*) from painel.eventos where tipo = 'contrato_fechado' and ref like 'c%') >= 4, 'um por contrato';
  assert painel.eventos_atualizar() = 0, 'idempotente';
  select * into r from painel.funil_periodo(((hoje - 1)::timestamp at time zone 'America/Sao_Paulo'), ((hoje + 2)::timestamp at time zone 'America/Sao_Paulo')) where etapa = 'Contrato';
  assert r.entraram >= 4, 'a etapa Contrato do funil mostra os contratos: ' || r.entraram;
  assert not has_function_privilege('anon', 'mayara.crm_status_pendentes(integer)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0079' as resultado;
