-- supabase/tests/0008_workers_filtro.test.sql
-- Rodar inteiro (execute_sql). Usa so numeros ficticios; termina em rollback.
-- As queries abaixo sao as dos nodes de selecao:
--   fu  = "Buscar e Reservar Leads"      (workflow CxlC28G0S3uE8X66, follow-up)
--   lem = "Buscar e Reservar Lembretes"  (workflow YlRXMT6gEopuwFof, lembretes)
-- Ambas devem devolver so a sessao cujo lead esta 'ativo'.
begin;

create temp table res_fu (session_key text);
create temp table res_lem (session_key text);

-- leads: 30 ativo, 31 sem_interesse (follow-up); 32 ativo, 33 sem_interesse (lembretes)
select mayara.upsert_lead_autorizado('+5511999990030','A',null,null,'teste',null,'{}'::jsonb);
select mayara.upsert_lead_autorizado('+5511999990031','S',null,null,'teste',null,'{}'::jsonb);
select mayara.upsert_lead_autorizado('+5511999990032','A',null,null,'teste',null,'{}'::jsonb);
select mayara.upsert_lead_autorizado('+5511999990033','S',null,null,'teste',null,'{}'::jsonb);
update mayara.leads_autorizados set status = 'sem_interesse' where telefone in ('+5511999990031','+5511999990033');

-- sessoes elegiveis para follow-up
insert into mayara.session_state (session_key, phone, estado, follow_up_status, follow_up_stage, last_lead_message_at)
values ('whatsapp:1365007506685934:+5511999990030', '+5511999990030', 'S1_TRIAGEM', 'ativo', 'nenhum', now() - interval '5 hours'),
       ('whatsapp:1365007506685934:+5511999990031', '+5511999990031', 'S1_TRIAGEM', 'ativo', 'nenhum', now() - interval '5 hours');

-- sessoes elegiveis para lembrete (consulta em 30 min => 1h)
insert into mayara.session_state (session_key, phone, estado, follow_up_status, lembrete_consulta_estagio, consulta_agendada_em)
values ('whatsapp:1365007506685934:+5511999990032', '+5511999990032', 'S6_AGENDADO', 'transferido_consulta', 'nenhum', now() + interval '30 minutes'),
       ('whatsapp:1365007506685934:+5511999990033', '+5511999990033', 'S6_AGENDADO', 'transferido_consulta', 'nenhum', now() + interval '30 minutes');

do $t$
declare r record;
begin
  for r in execute $q$
  with claimed as (
    select session_key
    from mayara.session_state
    where follow_up_status = 'ativo'
      and follow_up_stage = 'nenhum'
      and phone is not null
      and estado not in ('S6_AGENDADO', 'S7_HANDOFF_HUMANO', 'S3_PRIORIDADE_JURIDICA')
      and coalesce(fatos_json->>'situacaoJudicial', 'nenhuma') not in ('execucao', 'execução', 'recuperacao_judicial', 'recuperação_judicial', 'falencia', 'falência')
      and last_lead_message_at is not null
      and now() - last_lead_message_at >= interval '4 hours'
      and now() - last_lead_message_at < interval '24 hours'
      and mayara.lead_ativo_da_sessao(session_key)
    order by last_lead_message_at
    for update skip locked
    limit 20
  )
  update mayara.session_state s
  set follow_up_stage = 'ia_sumiu_meio',
      follow_up_last_sent_at = now(),
      follow_up_tentativas = follow_up_tentativas + 1
  from claimed
  where s.session_key = claimed.session_key
  returning s.session_key, s.phone, s.phone_number_id, s.estado, s.fatos_json
  $q$ loop
    insert into res_fu values (r.session_key);
  end loop;

  for r in execute $q$
  with elegivel as (
    select session_key,
      case
        when now() >= consulta_agendada_em - interval '15 minutes' and lembrete_consulta_estagio <> '15min' then '15min'
        when now() >= consulta_agendada_em - interval '1 hour' and lembrete_consulta_estagio not in ('1h', '15min') then '1h'
        when now() >= consulta_agendada_em - interval '1 day' and lembrete_consulta_estagio = 'nenhum' then '1dia'
        else null
      end as proximo_estagio
    from mayara.session_state
    where estado = 'S6_AGENDADO'
      and follow_up_status not in ('excluido_seguranca')
      and consulta_agendada_em is not null
      and consulta_agendada_em > now()
      and lembrete_consulta_estagio <> '15min'
      and mayara.lead_ativo_da_sessao(session_key)
    for update skip locked
  )
  update mayara.session_state s
  set lembrete_consulta_estagio = e.proximo_estagio,
      follow_up_status = case when e.proximo_estagio = '15min' then 'transferido_consulta' else s.follow_up_status end
  from elegivel e
  where s.session_key = e.session_key
    and e.proximo_estagio is not null
  returning s.session_key, s.phone, s.phone_number_id, s.estado, s.fatos_json::text as "fatosJson", s.consulta_agendada_em, e.proximo_estagio
  $q$ loop
    insert into res_lem values (r.session_key);
  end loop;

  assert (select count(*) from res_fu where session_key like '%:+551199999003_') = 1, 'follow-up: so uma sessao de teste deve aparecer';
  assert exists (select 1 from res_fu where session_key = 'whatsapp:1365007506685934:+5511999990030'), 'follow-up: lead ativo aparece';
  assert not exists (select 1 from res_fu where session_key = 'whatsapp:1365007506685934:+5511999990031'), 'follow-up: lead sem_interesse nao aparece';
  assert (select count(*) from res_lem where session_key like '%:+551199999003_') = 1, 'lembretes: so uma sessao de teste deve aparecer';
  assert exists (select 1 from res_lem where session_key = 'whatsapp:1365007506685934:+5511999990032'), 'lembretes: lead ativo aparece';
  assert not exists (select 1 from res_lem where session_key = 'whatsapp:1365007506685934:+5511999990033'), 'lembretes: lead sem_interesse nao aparece';
end $t$;

rollback;
