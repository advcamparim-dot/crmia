-- supabase/tests/0053_nota_contexto.test.sql
begin;
do $t$
declare sid text := 'whatsapp:escritorio:+555199990801'; c text;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5551999990801', 'Nota Teste', 'ativo');
  insert into mayara.session_state (session_key, phone, estado) values (sid, '+555199990801', 'S2_QUALIFICACAO');
  insert into public.n8n_chat_histories (session_id, message) values (sid, '{"type":"human","content":"oi"}'::jsonb);

  assert mayara.registrar_nota_contexto('+5551999990801', E'Nota do sistema (não enviar ao lead): o WhatsApp ficou fora do ar.\n13/10 06:54 lead: preciso de ajuda') = true, 'grava a nota';
  select h.message ->> 'content' into c from public.n8n_chat_histories h where h.session_id = sid order by h.id desc limit 1;
  assert c like 'Nota do sistema (não enviar ao lead)%' and c like '%13/10 06:54 lead: preciso de ajuda', 'conteudo: ' || coalesce(c, 'null');
  assert (select message ->> 'type' from public.n8n_chat_histories where session_id = sid order by id desc limit 1) = 'ai', 'tipo ai';
  assert mayara.registrar_nota_contexto('+5551999990801', '   ') = false, 'nota vazia nao grava';
  assert mayara.registrar_nota_contexto('+5500000000000', 'x') = false, 'telefone sem lead nao grava';
  assert mayara.registrar_nota_contexto(null, 'x') = false, 'telefone nulo';
  -- a nota entra na sessao canonica quando o numero vem sem o nono digito
  assert mayara.registrar_nota_contexto('+5551999990801', 'segunda') = true, 'segunda nota grava';
  assert (select count(*) from public.n8n_chat_histories where session_id = sid) = 3, 'sessao canonica';
  -- limite de tamanho
  perform mayara.registrar_nota_contexto('+5551999990801', repeat('a', 6000));
  assert (select length(message ->> 'content') from public.n8n_chat_histories where session_id = sid order by id desc limit 1) <= 4000, 'limita o tamanho';
  assert not has_function_privilege('anon', 'mayara.registrar_nota_contexto(text,text)', 'execute'), 'anon sem execute';
end $t$;
rollback;
select 'OK 0053';
