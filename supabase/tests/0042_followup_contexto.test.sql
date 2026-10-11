-- supabase/tests/0042_followup_contexto.test.sql
begin;
do $t$
declare ca text := mayara.chave_telefone('+5511999990941'); cb text := mayara.chave_telefone('+5511999990942'); v_log bigint; j jsonb; n int;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990941', 'Dora Contexto Teste', 'ativo'), ('+5511999990942', 'Eva Sem Historico Teste', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, origem, criado_em) values
    ('escritorio', ca, 'texto', true, 'ponte', '2026-10-05 10:00:00-03'), ('escritorio', cb, 'texto', true, 'abordagem_assistida', '2026-10-05 10:00:00-03');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+551199990941', '{"type":"human","content":"Tenho um Pronampe atrasado"}'::jsonb, '2026-10-05 09:50:00-03'),
    ('whatsapp:escritorio:+551199990941', '{"type":"ai","content":"Esse Pronampe é com qual banco?"}'::jsonb, '2026-10-05 10:00:00-03');
  insert into mayara.session_state (session_key, phone, estado, fatos_json) values
    ('whatsapp:escritorio:+5511999990941', '+5511999990941', 'S2_QUALIFICACAO', '{"tipoDivida":"Pronampe"}'::jsonb);
  insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida) values
    (ca, 'conversa', 1, 'reservado', '2026-10-05 10:00:00-03'), (cb, 'nunca_respondeu', 1, 'reservado', '2026-10-05 10:00:00-03');

  select id into v_log from mayara.followups_log where chave = ca;
  j := mayara.contexto_followup(v_log);
  assert (j ->> 'nome') = 'Dora Contexto Teste' and (j ->> 'telefone') = '+5511999990941', 'nome e telefone: ' || j::text;
  assert jsonb_array_length(j -> 'mensagens') = 2 and (j -> 'mensagens' -> 0 ->> 'papel') = 'lead' and (j -> 'mensagens' -> 1 ->> 'papel') = 'mayara', 'mensagens em ordem e com papel: ' || (j -> 'mensagens')::text;
  assert (j -> 'fatos' ->> 'tipoDivida') = 'Pronampe', 'fatos';
  assert (j ->> 'tentativa') = '1' and jsonb_array_length(j -> 'anteriores') = 0, 'tentativa 1 sem anteriores';
  assert mayara.contexto_followup(999999999) = '{}'::jsonb, 'log inexistente';

  perform mayara.registrar_followup(v_log, 'enviado', 'Bom dia, Dora. Conseguiu ver minha pergunta?', 'ia', null);
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+551199990941' and message ->> 'content' = 'Bom dia, Dora. Conseguiu ver minha pergunta?') = 1, 'memoria na sessao do lead';
  j := mayara.contexto_followup((select id from mayara.followups_log where chave = ca));
  assert (j ->> 'tentativa') = '2' and (j -> 'anteriores' ->> 0) = 'Bom dia, Dora. Conseguiu ver minha pergunta?', 'anteriores e tentativa 2: ' || j::text;

  select id into v_log from mayara.followups_log where chave = cb;
  perform mayara.registrar_followup(v_log, 'enviado', 'Bom dia, Eva. Tudo bem?', 'fixo', null);
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990942') = 1, 'sem sessao: cria pelo telefone';

  insert into mayara.followups_log (chave, sequencia, etapa, estado, ciclo_saida)
    select ca, 'conversa', 2, 'reservado', '2026-10-05 10:00:00-03' where not exists (select 1 from mayara.followups_log where chave = ca and estado = 'reservado');
  perform mayara.registrar_followup((select id from mayara.followups_log where chave = ca and estado = 'reservado'), 'simulado', 'Texto simulado', 'fixo', null);
  select count(*) into n from public.n8n_chat_histories where message ->> 'content' = 'Texto simulado';
  assert n = 0, 'simulado nao grava memoria: ' || n;
  assert not has_function_privilege('anon', 'mayara.contexto_followup(bigint)', 'execute'), 'anon contexto';
end $t$;
rollback;
select 'OK 0042' as resultado;
