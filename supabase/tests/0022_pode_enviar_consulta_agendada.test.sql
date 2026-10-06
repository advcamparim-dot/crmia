-- supabase/tests/0022_pode_enviar_consulta_agendada.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare r jsonb;
begin
  -- lead que nao escreve ha 5 dias, mas tem consulta agendada no futuro
  insert into mayara.session_state (session_key, phone, last_lead_message_at, consulta_agendada_em)
  values ('t-janela-1', '5511999990777', now() - interval '5 days', now() + interval '2 days');
  r := mayara.pode_enviar('escritorio', '5511999990777', 'template');
  assert (r ->> 'ok') = 'true', 'consulta futura libera o lembrete: ' || r::text;

  -- sem consulta agendada continua bloqueado fora da janela
  insert into mayara.session_state (session_key, phone, last_lead_message_at)
  values ('t-janela-2', '5511999990778', now() - interval '5 days');
  r := mayara.pode_enviar('escritorio', '5511999990778', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'fora_da_janela', 'sem consulta continua fora da janela: ' || r::text;

  -- consulta ja passada nao libera
  insert into mayara.session_state (session_key, phone, last_lead_message_at, consulta_agendada_em)
  values ('t-janela-3', '5511999990779', now() - interval '5 days', now() - interval '1 day');
  r := mayara.pode_enviar('escritorio', '5511999990779', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'fora_da_janela', 'consulta passada nao libera: ' || r::text;
end $t$;

rollback;
select 'OK 0022' as resultado;
