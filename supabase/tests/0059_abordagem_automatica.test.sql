-- supabase/tests/0059_abordagem_automatica.test.sql
begin;
do $t$
declare
  j jsonb; n int; pid bigint;
  segunda timestamptz := timestamptz '2026-10-19 13:00:00+00';   -- segunda 10:00 em Sao Paulo
  domingo timestamptz := timestamptz '2026-10-18 13:00:00+00';
begin
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';
  update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
  update mayara.config set valor = '2' where chave = 'abordagem_auto_teto_hora';

  -- tres leads novos com proposta aberta
  perform mayara.criar_proposta('+5511999990801', 'Auto Um',   't-801', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990802', 'Auto Dois', 't-802', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  perform mayara.criar_proposta('+5511999990803', 'Auto Tres', 't-803', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  update mayara.propostas_abordagem set criado_em = now() - interval '3 hours' where telefone = '+5511999990801';
  update mayara.propostas_abordagem set criado_em = now() - interval '2 hours' where telefone = '+5511999990802';
  update mayara.propostas_abordagem set criado_em = now() - interval '1 hours' where telefone = '+5511999990803';

  -- chave desligada: nada acontece
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'desligada' and (j ->> 'enviar') = 'false', 'desligada: ' || j::text;
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta' and telefone like '+55119999908%') = 3, 'nada aprovado com a chave desligada';

  update mayara.config set valor = 'true' where chave = 'abordagem_automatica';

  -- gates
  update mayara.canal_estado set estado = 'close' where canal_id = 'escritorio';
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'canal_fechado', 'canal fechado';
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  assert (mayara.abordagem_auto_proximo(domingo) ->> 'motivo') = 'fora_do_expediente', 'domingo';
  assert (mayara.abordagem_auto_proximo(timestamptz '2026-10-19 08:00:00+00') ->> 'motivo') = 'fora_do_expediente', '05:00 em Sao Paulo';
  update mayara.config set valor = 'false' where chave = 'abordagem_assistida';
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'assistida_desligada', 'assistida desligada';
  update mayara.config set valor = 'true' where chave = 'abordagem_assistida';
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta' and telefone like '+55119999908%') = 3, 'gates nao aprovam nada';

  -- primeiro envio: a proposta mais antiga, aprovada pelo autor automatico, janela aberta
  j := mayara.abordagem_auto_proximo(segunda);
  assert (j ->> 'enviar') = 'true' and j ->> 'destino' = '+5511999990801' and j ->> 'nome' = 'Auto Um', 'mais antiga primeiro: ' || j::text;
  pid := (j ->> 'proposta_id')::bigint;
  assert (select estado from mayara.propostas_abordagem where id = pid) = 'aprovada', 'aprovada';
  assert (select aprovada_por from mayara.propostas_abordagem where id = pid) = 'automatico', 'autor automatico';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone = '+5511999990801') is not null, 'janela aberta';

  -- registrar ok: proposta enviada
  j := mayara.abordagem_auto_registrar(pid, true, null);
  assert (j ->> 'pausada') = 'false', 'registrar ok: ' || j::text;
  assert (select estado from mayara.propostas_abordagem where id = pid) = 'enviada', 'proposta enviada';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990801'), 'texto', true, 'AUTO1', 'abordagem_automatica', now());

  -- lead com conversa recente e administrador sao descartados, o proximo sai
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:escritorio:+5511999990802', '+5511999990802', 'S2_QUALIFICACAO', segunda - interval '1 hour');
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'descartada', 'conversa recente descarta: ' || j::text;
  assert (select erro from mayara.propostas_abordagem where telefone = '+5511999990802') = 'conversa_recente', 'motivo gravado';
  j := mayara.abordagem_auto_proximo(segunda);
  assert (j ->> 'enviar') = 'true' and j ->> 'destino' = '+5511999990803', 'proximo apos descarte: ' || j::text;
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999990803'), 'texto', true, 'AUTO2', 'abordagem_automatica', segunda);

  -- teto por hora (2)
  perform mayara.criar_proposta('+5511999990804', 'Auto Quatro', 't-804', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  update mayara.envios_log set criado_em = segunda - interval '10 minutes' where provedor_message_id = 'AUTO1';
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'teto_hora', 'teto por hora';
  assert (select estado from mayara.propostas_abordagem where telefone = '+5511999990804') = 'aberta', 'fica aberta para o administrador';
  update mayara.config set valor = '10' where chave = 'abordagem_auto_teto_hora';

  -- administrador nunca recebe automatico
  insert into mayara.administradores (telefone, nome) values ('+5511999990804', 'Admin Auto');
  j := mayara.abordagem_auto_proximo(segunda);
  assert j ->> 'motivo' = 'descartada' and (select erro from mayara.propostas_abordagem where telefone = '+5511999990804') = 'administrador', 'administrador descartado: ' || j::text;
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'fila_vazia', 'fila vazia';

  -- aprovacao manual simultanea: o sim N ja aprovou, o automatico nao envia de novo
  perform mayara.criar_proposta('+5511999990805', 'Auto Cinco', 't-805', 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
  select id into pid from mayara.propostas_abordagem where telefone = '+5511999990805';
  perform mayara.aprovar_proposta(pid, 'manual');
  assert (mayara.abordagem_auto_proximo(segunda) ->> 'motivo') = 'fila_vazia', 'proposta ja aprovada nao e reenviada';

  -- tres falhas seguidas desligam a chave; falha isolada nao
  for n in 1..3 loop
    perform mayara.criar_proposta('+55119999908' || (10 + n), 'Falha ' || n, 't-81' || n, 'Boa tarde, Auto. Tudo bem? Aqui é a Mayara. Qual o banco?', '{}'::jsonb, 'banco');
    j := mayara.abordagem_auto_proximo(segunda);
    assert (j ->> 'enviar') = 'true', 'falha ' || n || ' liberada: ' || j::text;
    j := mayara.abordagem_auto_registrar((j ->> 'proposta_id')::bigint, false, 'erro 500');
    assert (j ->> 'pausada') = (n = 3)::text, 'pausa so na terceira: ' || j::text;
  end loop;
  assert (select valor from mayara.config where chave = 'abordagem_automatica') = 'false', 'tres falhas desligam';

  -- resumo
  j := mayara.abordagem_auto_resumo(24);
  assert (j ->> 'ligada') = 'false' and (j ->> 'enviadas')::int >= 1 and (j ->> 'falhas')::int >= 3, 'resumo: ' || j::text;

  assert not has_function_privilege('anon', 'mayara.abordagem_auto_proximo(timestamptz)', 'execute'), 'anon sem execute';
  assert (select valor from mayara.config where chave = 'abordagem_automatica') is not null, 'chave existe';
end $t$;
rollback;
select 'OK 0059';
