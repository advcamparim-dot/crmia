-- supabase/tests/0051_sessao_do_lead.test.sql
begin;
do $t$
declare
  a text := 'whatsapp:escritorio:+5551999990601';   -- com nono digito (CRM)
  b text := 'whatsapp:escritorio:+555199990601';    -- sem nono digito (WhatsApp)
  c text := 'whatsapp:escritorio:+5551999990602';
  r text; j jsonb; n int;
begin
  insert into mayara.session_state (session_key, phone, estado, fatos_json, created_at) values
    (a, '+5551999990601', 'S1_ENGAJADO', '{"tipoDivida":"Pronampe","valor":"200 mil"}'::jsonb, now() - interval '2 hours'),
    (b, '+555199990601', 'S2_QUALIFICACAO', '{"banco":"Sicoob"}'::jsonb, now() - interval '1 hour');
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    (a, '{"type":"ai","content":"abordagem"}'::jsonb, now() - interval '110 minutes'),
    (b, '{"type":"human","content":"Boa tarde"}'::jsonb, now() - interval '50 minutes'),
    (b, '{"type":"ai","content":"resposta"}'::jsonb, now() - interval '49 minutes'),
    (b, '{"type":"human","content":"Sicoob"}'::jsonb, now() - interval '48 minutes');

  -- sessao do lead: a com mais historico, qualquer que seja a variante do numero
  assert mayara.sessao_do_lead('+5551999990601', c) = b, 'com 9 resolve para a sessao com mais historico';
  assert mayara.sessao_do_lead('+555199990601', c) = b, 'sem 9 resolve para a mesma';
  assert mayara.sessao_do_lead('+5551999990999', c) = c, 'lead sem sessao devolve a chave pedida';
  assert mayara.sessao_do_lead(null, c) = c, 'telefone nulo devolve a chave pedida';
  assert mayara.sessao_do_lead('abc', c) = c, 'telefone invalido devolve a chave pedida';

  -- sessao so de historico (sem linha em session_state) tambem conta
  insert into public.n8n_chat_histories (session_id, message, created_at) values
    ('whatsapp:escritorio:+555199990701', '{"type":"human","content":"oi"}'::jsonb, now() - interval '3 hours'),
    ('whatsapp:escritorio:+555199990701', '{"type":"ai","content":"ola"}'::jsonb, now() - interval '3 hours'),
    ('whatsapp:escritorio:+555199990701', '{"type":"human","content":"quero ajuda"}'::jsonb, now() - interval '3 hours'),
    ('whatsapp:escritorio:+555199990701', '{"type":"ai","content":"claro"}'::jsonb, now() - interval '3 hours');
  insert into mayara.session_state (session_key, phone, estado) values ('whatsapp:escritorio:+5551999990701', '+5551999990701', 'S1_ENGAJADO');
  assert mayara.sessao_do_lead('+5551999990701', null) = 'whatsapp:escritorio:+555199990701', 'sessao so de historico com mais mensagens vence a vazia';

  -- evento: so a chave de sessao muda
  j := mayara.com_sessao_canonica(jsonb_build_object('phone', '+5551999990601', 'sessionKey', a, 'message', 'oi', 'messageId', 'X1'));
  assert j ->> 'sessionKey' = b and j ->> 'message' = 'oi' and j ->> 'messageId' = 'X1' and j ->> 'phone' = '+5551999990601', 'evento reescrito: ' || j::text;
  j := mayara.com_sessao_canonica(jsonb_build_object('phone', '+5551999990999', 'sessionKey', c));
  assert j ->> 'sessionKey' = c, 'evento de lead sem sessao nao muda';
  assert mayara.com_sessao_canonica('{"message":"sem telefone"}'::jsonb) = '{"message":"sem telefone"}'::jsonb, 'evento sem telefone intacto';

  -- criar sessao de reativacao reaproveita a existente
  perform mayara.iniciar_sessao_reativacao(a, '+5551999990601', '{"origem":"grupo"}'::jsonb);
  select count(*) into n from mayara.session_state where mayara.chave_telefone(phone) = mayara.chave_telefone('+5551999990601');
  assert n = 2, 'nao cria terceira sessao: ' || n;
  assert (select fatos_json ->> 'origem' from mayara.session_state where session_key = b) = 'grupo', 'fatos da reativacao entram na sessao canonica';

  -- fala humana vai para a sessao canonica
  assert mayara.registrar_mensagem_humana('+5551999990601', 'Posso ligar?', now()) = true, 'humana grava';
  assert (select count(*) from public.n8n_chat_histories where session_id = b and message ->> 'content' like 'Mensagem enviada por uma pessoa%') = 1, 'humana na sessao canonica';
  assert (select count(*) from public.n8n_chat_histories where session_id = a and message ->> 'content' like 'Mensagem enviada por uma pessoa%') = 0, 'humana nao vai para a duplicata';

  -- unir duplicatas
  j := mayara.unir_sessoes_duplicadas(mayara.chave_telefone('+5551999990601'));
  assert (j ->> 'unidas')::int = 1 and j ->> 'canonica' = b, 'unir: ' || j::text;
  assert (select fatos_json from mayara.session_state where session_key = b) = '{"banco":"Sicoob","tipoDivida":"Pronampe","valor":"200 mil","origem":"grupo"}'::jsonb, 'fatos unidos, canonica vence conflito';
  assert (select estado from mayara.session_state where session_key = b) = 'S2_QUALIFICACAO', 'estado da canonica preservado';
  assert (select count(*) from public.n8n_chat_histories where session_id = a) = 0, 'historico da duplicata foi movido';
  assert (select count(*) from public.n8n_chat_histories where session_id = b) = 5, 'historico somado na canonica';
  assert (select unida_em is not null and phone is null and unida_para = b from mayara.session_state where session_key = a), 'duplicata marcada como unida';
  assert mayara.sessao_do_lead('+5551999990601', c) = b, 'depois de unir, continua a canonica';
  j := mayara.unir_sessoes_duplicadas(mayara.chave_telefone('+5551999990601'));
  assert (j ->> 'unidas')::int = 0, 'idempotente';
  assert mayara.registrar_mensagem_humana('+555199990601', 'Outra', now()) = true, 'humana apos unir';
end $t$;
rollback;
select 'OK 0051';
