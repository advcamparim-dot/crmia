-- supabase/tests/0012_canais.test.sql
-- Rodar inteiro (execute_sql). Numeros ficticios; termina em rollback.
begin;

insert into mayara.canais (canal_id, provedor, rotulo) values
  ('t-meta', 'meta', 'Teste Meta'),
  ('t-evo', 'evolution', 'Teste Evolution'),
  ('t-off', 'meta', 'Teste Inativo');
update mayara.canais set ativo = false where canal_id = 't-off';

do $t$
declare r jsonb; i int;
begin
  -- canal desconhecido / inativo / meta
  r := mayara.pode_enviar('nao-existe', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'false' and (r ->> 'motivo') = 'canal_desconhecido', 'desconhecido: ' || r::text;
  r := mayara.pode_enviar('t-off', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'canal_inativo', 'inativo: ' || r::text;
  r := mayara.pode_enviar('t-meta', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'meta', 'meta libera: ' || r::text;
  r := mayara.pode_enviar('1365007506685934', '5514997022609', 'texto');
  assert (r ->> 'ok') = 'true', 'linha Meta real cadastrada na migration: ' || r::text;

  -- evolution: destino invalido, fora da janela, dentro da janela (sessao), dentro da janela (comando)
  r := mayara.pode_enviar('t-evo', '123', 'texto');
  assert (r ->> 'motivo') = 'destino_invalido', 'destino invalido: ' || r::text;
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'sem mensagem recebida: ' || r::text;

  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:t-evo:+5511999990201', '+5511999990201', 'S1_ENGAJADO', now() - interval '1 hour');
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'ok') = 'true' and (r ->> 'provedor') = 'evolution', 'dentro da janela: ' || r::text;
  update mayara.session_state set last_lead_message_at = now() - interval '49 hours' where session_key = 'whatsapp:t-evo:+5511999990201';
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'janela de 48h vencida: ' || r::text;

  insert into mayara.comandos_log (message_id, admin_chave, entrada, criado_em)
    values ('wamid.canal1', mayara.chave_telefone('+5511999990202'), '/status', now() - interval '10 minutes');
  r := mayara.pode_enviar('t-evo', '5511999990202', 'texto');
  assert (r ->> 'ok') = 'true', 'administrador que escreveu ha pouco tambem libera: ' || r::text;

  -- teto por minuto
  update mayara.config set valor = '3' where chave = 'evolution_teto_por_minuto';
  update mayara.session_state set last_lead_message_at = now() where session_key = 'whatsapp:t-evo:+5511999990201';
  for i in 1..3 loop
    perform mayara.registrar_envio('t-evo', '5511999990201', 'texto', '{"ok":true,"messages":[{"id":"x"}]}'::jsonb);
  end loop;
  r := mayara.pode_enviar('t-evo', '5511999990201', 'texto');
  assert (r ->> 'motivo') = 'teto_por_minuto', 'teto: ' || r::text;
  update mayara.config set valor = '20' where chave = 'evolution_teto_por_minuto';

  -- registrar_envio devolve o resultado e grava os campos certos
  r := mayara.registrar_envio('t-meta', '5511999990203', 'texto', '{"ok":true,"messages":[{"id":"wamid.AAA"}]}'::jsonb);
  assert (r ->> 'ok') = 'true', 'devolve o resultado de sucesso';
  assert (select provedor_message_id from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990203')) = 'wamid.AAA', 'grava o id do provedor';
  r := mayara.registrar_envio('t-meta', '5511999990204', 'template', '{"ok":false,"error":{"message":"falhou"}}'::jsonb);
  assert (r #>> '{error,message}') = 'falhou', 'devolve o resultado de falha';
  assert (select erro from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990204')) = 'falhou', 'grava o erro';
  assert (select ok from mayara.envios_log where destino_chave = mayara.chave_telefone('5511999990204')) = false, 'grava ok=false';
end $t$;

rollback;
select 'OK 0012' as resultado;
