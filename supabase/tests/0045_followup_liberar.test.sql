-- supabase/tests/0045_followup_liberar.test.sql
begin;
do $t$
declare cj text := mayara.chave_telefone('+5511999990961'); ca text := mayara.chave_telefone('+5511999990962'); r text; n int;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990961', 'Juridico Liberacao Teste', 'ativo'), ('+5511999990962', 'Agendado Liberacao Teste', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, origem, criado_em) values
    ('escritorio', cj, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'), ('escritorio', ca, 'texto', true, 'ponte', '2026-10-05 10:00:00-03');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+5511999990961', '{"type":"human","content":"processo judicial"}'::jsonb, '2026-10-05 09:50:00-03'),
    ('whatsapp:escritorio:+5511999990962', '{"type":"human","content":"oi"}'::jsonb, '2026-10-05 09:50:00-03');
  insert into mayara.session_state (session_key, phone, estado, fatos_json) values
    ('whatsapp:escritorio:+5511999990961', '+5511999990961', 'S3_PRIORIDADE_JURIDICA', '{"situacaoJudicial":"execução"}'::jsonb),
    ('whatsapp:escritorio:+5511999990962', '+5511999990962', 'S3_PRIORIDADE_JURIDICA', '{}'::jsonb);
  assert mayara._lead_excluido(cj, '2026-10-05 12:05:00-03') = 'excluido_seguranca', 'sem liberacao: fora';
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cj;
  assert n = 0, 'sem liberacao nao e elegivel: ' || n;
  r := mayara.comando_followup('liberar +5511999990961');
  assert r like 'Liberei o follow-up de Juridico Liberacao Teste (final 0961)%', 'liberar: ' || r;
  assert mayara._lead_excluido(cj, '2026-10-05 12:05:00-03') is null, 'com liberacao: dentro';
  select count(*) into n from mayara.followups_elegiveis('2026-10-05 12:05:00-03') where lead_chave = cj;
  assert n = 1, 'com liberacao e elegivel: ' || n;
  r := mayara.comando_followup('liberar +5511999990962');
  update mayara.session_state set consulta_agendada_em = '2026-10-20 10:00:00-03' where session_key = 'whatsapp:escritorio:+5511999990962';
  assert mayara._lead_excluido(ca, '2026-10-05 12:05:00-03') = 'excluido_seguranca', 'consulta agendada continua fora';
  update mayara.session_state set consulta_agendada_em = null, estado = 'S7_HANDOFF_HUMANO' where session_key = 'whatsapp:escritorio:+5511999990962';
  assert mayara._lead_excluido(ca, '2026-10-05 12:05:00-03') = 'excluido_seguranca', 'equipe continua fora';
  r := mayara.comando_followup('encerrar +5511999990961');
  assert (select liberar_prioridade_juridica from mayara.followup_estado where chave = cj) = true, 'liberacao preservada';
  assert mayara._lead_excluido(cj, '2026-10-05 12:05:00-03') = 'encerrado', 'encerrado continua fora';
  r := mayara.comando_followup('liberar');
  assert r like 'Diga o lead%', 'sem alvo: ' || r;
  r := mayara.comando_followup('liberar +5511999990999');
  assert r like '%não está na lista%', 'desconhecido: ' || r;
  assert mayara.comando_followup('xyz') like '%/followup liberar <lead>%', 'ajuda cita liberar';
end $t$;
rollback;
select 'OK 0045' as resultado;
