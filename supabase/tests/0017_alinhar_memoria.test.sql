-- supabase/tests/0017_alinhar_memoria.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;
insert into public.n8n_chat_histories (session_id, message, created_at) values
 ('t-trg', '{"type":"human","content":"Ok"}'::jsonb, now() - interval '9 seconds'),
 ('t-trg', '{"type":"ai","content":"Calling Salvar_Estado with input: {}"}'::jsonb, now() - interval '8 seconds'),
 ('t-trg', '{"type":"ai","content":"Santo, você recebeu alguma notificação do banco?","tool_calls":[],"additional_kwargs":{}}'::jsonb, now() - interval '7 seconds'),
 ('t-outra', '{"type":"ai","content":"Resposta de outra sessao"}'::jsonb, now());
insert into mayara.bridge_responses (session_key, output) values ('t-trg', 'Certo, Santo! Estou por aqui.')
on conflict (session_key) do update set output = excluded.output;
do $t$
begin
  assert (select message->>'content' from public.n8n_chat_histories where session_id = 't-trg' and message->>'type' = 'ai' and message->>'content' not like 'Calling %') = 'Certo, Santo! Estou por aqui.', '1. memoria alinhada pelo gatilho';
  assert (select message->>'content' from public.n8n_chat_histories where session_id = 't-trg' and message->>'content' like 'Calling %') = 'Calling Salvar_Estado with input: {}', '2. linha de chamada de ferramenta intacta';
  assert (select message->>'content' from public.n8n_chat_histories where session_id = 't-trg' and message->>'type' = 'human') = 'Ok', '3. mensagem do lead intacta';
  assert (select message->'tool_calls' from public.n8n_chat_histories where session_id = 't-trg' and message->>'content' like 'Certo%') = '[]'::jsonb, '4. demais campos preservados';
  assert (select message->>'content' from public.n8n_chat_histories where session_id = 't-outra') = 'Resposta de outra sessao', '5. outra sessao intacta';
end $t$;
insert into public.n8n_chat_histories (session_id, message, created_at) values
 ('t-trg', '{"type":"human","content":"ok"}'::jsonb, now() - interval '4 seconds'),
 ('t-trg', '{"type":"ai","content":"Outra pergunta do modelo sobre processo judicial?","tool_calls":[]}'::jsonb, now() - interval '3 seconds');
insert into mayara.bridge_responses (session_key, output) values ('t-trg', 'Certo, Santo! Estou por aqui.')
on conflict (session_key) do update set output = excluded.output;
do $t$
begin
  assert (select message->>'content' from public.n8n_chat_histories where session_id = 't-trg' and message->>'type' = 'ai' and message->>'content' not like 'Calling %' order by id desc limit 1) = 'Certo, Santo! Estou por aqui.', '6. segundo turno com texto igual tambem alinha';
  assert not has_function_privilege('anon', 'mayara.alinhar_memoria_com_resposta()', 'execute'), '7. anon sem execute';
end $t$;
rollback;
select 'OK 0017' as resultado;
