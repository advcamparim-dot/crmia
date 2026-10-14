-- supabase/tests/0049_blindagem_canal.test.sql
begin;
do $t$
declare
  r jsonb; b boolean; t0 timestamptz := timestamptz '2026-10-20 12:00:00+00';
  sid text; n int; l int;
begin
  -- mensagens vistas
  assert mayara.marcar_mensagem_vista('teste_vigia', 'MSG1', 'entrada', 'webhook') = true, 'primeira vez e nova';
  assert mayara.marcar_mensagem_vista('teste_vigia', 'MSG1', 'entrada', 'recuperacao') = false, 'segunda vez nao e nova';
  assert mayara.mensagem_ja_vista('teste_vigia', 'MSG1') = true and mayara.mensagem_ja_vista('teste_vigia', 'MSG2') = false, 'ja_vista';
  begin
    perform mayara.marcar_mensagem_vista('teste_vigia', 'MSG3', 'invalida', 'webhook');
    assert false, 'direcao invalida deveria falhar';
  exception when check_violation then null;
  end;

  -- mensagem humana: memoria e assuncao do lead
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990491', 'Humano Teste', 'ativo');
  insert into mayara.session_state (session_key, estado, phone) values ('whatsapp:escritorio:+5511999990491', 'S2_QUALIFICACAO', '+5511999990491');
  r := mayara.tratar_mensagem_humana('teste_vigia', '+5511999990491', 'HUM1', 'Olá, aqui é do escritório. Posso ligar hoje?', t0);
  assert r ->> 'acao' = 'assumido' and (r ->> 'memoria') = 'true', 'humano assume e grava: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990491') = 'bloqueado', 'lead assumido';
  select h.message ->> 'content' into sid from public.n8n_chat_histories h
   where h.session_id = 'whatsapp:escritorio:+5511999990491' order by h.id desc limit 1;
  assert sid = 'Mensagem enviada por uma pessoa do escritório: Olá, aqui é do escritório. Posso ligar hoje?', 'memoria: ' || coalesce(sid, 'null');
  assert (select (message ->> 'type') from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990491' order by id desc limit 1) = 'ai', 'tipo ai';
  assert mayara.registrar_mensagem_humana('+5511999990491', '   ', t0) = false, 'texto vazio nao grava';
  assert mayara.registrar_mensagem_humana('+5500000000000', 'x', t0) = false, 'telefone sem lead nao grava';

  -- mensagem da propria Mayara nao assume e nao grava
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990492', 'Mayara Propria', 'ativo');
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem)
  values ('teste_vigia', mayara.chave_telefone('+5511999990492'), 'texto', true, 'PROPRIA1', 'teste');
  r := mayara.tratar_mensagem_humana('teste_vigia', '+5511999990492', 'PROPRIA1', 'texto da mayara', t0);
  assert r ->> 'acao' = 'mayara' and (r ->> 'memoria') = 'false', 'mensagem propria: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990492') = 'ativo', 'mensagem propria nao assume';

  -- politica do vigia
  insert into mayara.canal_estado (canal_id, estado, atualizado_em, sincronizado_ate)
  values ('teste_vigia', 'open', t0, t0 - interval '5 minutes');
  update mayara.config set valor = 'false' where chave = 'canal_vigia';
  assert mayara.leitura_canal('teste_vigia', 'close', t0) ->> 'acao' = 'nada', 'vigia desligado';
  update mayara.config set valor = 'true' where chave = 'canal_vigia';
  assert mayara.leitura_canal('teste_vigia', 'xyz', t0) ->> 'acao' = 'nada', 'leitura invalida';
  assert mayara.leitura_canal('canal_que_nao_existe', 'open', t0) ->> 'acao' = 'nada', 'canal desconhecido';

  r := mayara.leitura_canal('teste_vigia', 'open', t0);
  assert r ->> 'acao' = 'recuperar' and (r ->> 'desde')::timestamptz = t0 - interval '15 minutes', 'primeira leitura recupera desde sincronizado-10min: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'open', t0 + interval '2 minutes') ->> 'acao' = 'nada', 'open normal nao faz nada';
  assert mayara.leitura_canal('teste_vigia', 'open', t0 + interval '16 minutes') ->> 'acao' = 'recuperar', 'recuperacao periodica a cada 15 min';
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '16 minutes');

  r := mayara.leitura_canal('teste_vigia', 'close', t0 + interval '20 minutes');
  assert r ->> 'acao' = 'reiniciar' and (r ->> 'tentativas')::int = 1, 'queda: reinicio 1: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '22 minutes') ->> 'acao' = 'nada', 'intervalo de 4 min';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '24 minutes') ->> 'acao' = 'reiniciar', 'reinicio 2';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '28 minutes') ->> 'acao' = 'reiniciar', 'reinicio 3';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '30 minutes') ->> 'acao' = 'nada', 'espera apos o 3o reinicio';
  r := mayara.leitura_canal('teste_vigia', 'close', t0 + interval '32 minutes');
  assert r ->> 'acao' = 'alertar' and (r ->> 'minutos_fora')::int = 12, 'alerta apos 3 reinicios: ' || r::text;
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '34 minutes') ->> 'acao' = 'nada', 'sem alerta repetido de imediato';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '93 minutes') ->> 'acao' = 'lembrar', 'lembrete apos 60 min';
  update mayara.canal_estado set lembretes_enviados = 12, ultimo_lembrete_em = t0 - interval '1 day' where canal_id = 'teste_vigia';
  assert mayara.leitura_canal('teste_vigia', 'close', t0 + interval '200 minutes') ->> 'acao' = 'nada', 'teto de 12 lembretes';

  r := mayara.leitura_canal('teste_vigia', 'open', t0 + interval '210 minutes');
  assert r ->> 'acao' = 'recuperar' and (r ->> 'desde')::timestamptz <= t0 + interval '20 minutes', 'volta: recupera cobrindo a queda: ' || r::text;
  select tentativas_restart, lembretes_enviados into n, l from mayara.canal_estado where canal_id = 'teste_vigia';
  assert n = 0 and l = 0 and (select queda_desde from mayara.canal_estado where canal_id = 'teste_vigia') is null, 'estado zerado ao voltar';

  -- connecting longo vale como close
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '300 minutes') ->> 'acao' = 'nada', 'connecting inicial registra queda';
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '305 minutes') ->> 'acao' = 'nada', 'connecting curto nao age';
  assert mayara.leitura_canal('teste_vigia', 'connecting', t0 + interval '307 minutes') ->> 'acao' = 'reiniciar', 'connecting de mais de 6 min vale como close';

  -- inalcancavel nao reinicia, so alerta depois de 6 min
  perform mayara.leitura_canal('teste_vigia', 'open', t0 + interval '400 minutes');
  assert mayara.leitura_canal('teste_vigia', 'inalcancavel', t0 + interval '410 minutes') ->> 'acao' = 'nada', 'inalcancavel inicial';
  r := mayara.leitura_canal('teste_vigia', 'inalcancavel', t0 + interval '417 minutes');
  assert r ->> 'acao' = 'alertar', 'inalcancavel alerta: ' || r::text;
  assert (select tentativas_restart from mayara.canal_estado where canal_id = 'teste_vigia') = 0, 'inalcancavel nao conta reinicio';

  -- concluir_recuperacao avanca o cursor e nunca recua
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '500 minutes');
  perform mayara.concluir_recuperacao('teste_vigia', t0 + interval '100 minutes');
  assert (select sincronizado_ate from mayara.canal_estado where canal_id = 'teste_vigia') = t0 + interval '500 minutes', 'cursor so avanca';
end $t$;
rollback;
select 'OK 0049';
