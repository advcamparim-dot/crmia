-- supabase/tests/0035_propostas_acoes.test.sql
begin;
do $t$
declare r jsonb; v_id bigint; v_id2 bigint; t text; n int;
begin
  -- aprovar: fluxo feliz
  v_id := (mayara.criar_proposta('+5511999990901', 'Bia Teste', 'crm-b1', 'Boa tarde, Bia. Qual banco?', '{"valorAproximado":"50 mil","origemLead":"grupo_agencia"}'::jsonb, 'banco(s) envolvido(s) na dívida') ->> 'id')::bigint;
  r := mayara.aprovar_proposta(v_id, '5514997022609');
  assert (r ->> 'ok') = 'true' and (r ->> 'texto') = 'Boa tarde, Bia. Qual banco?' and (r ->> 'destino') = '+5511999990901', 'aprova: ' || r::text;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'aprovada', 'estado aprovada';
  assert (select abordagem_ate from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990901')) > now() + interval '23 hours', 'janela de 24 h aberta';
  assert (mayara.pode_enviar('escritorio', '5511999990901', 'texto') ->> 'ok') = 'true', 'pode_enviar liberado';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990901') = 'S1_ENGAJADO', 'sessao engajada';
  assert (select fatos_json ->> 'valorAproximado' from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990901') = '50 mil', 'fatos do card na sessao';
  -- memoria ainda NAO tem a mensagem (so depois do envio confirmado)
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901') = 0, 'memoria intocada antes do envio';

  -- segunda aprovacao nao repete
  r := mayara.aprovar_proposta(v_id, '5514997022609');
  assert (r ->> 'motivo') = 'ja_aprovada', 'nao reenvia: ' || r::text;

  -- confirmar envio com sucesso: memoria recebe a fala da Mayara
  t := mayara.confirmar_envio_proposta(v_id, true, null);
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'enviada', 'estado enviada';
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901' and message ->> 'type' = 'ai' and message ->> 'content' = 'Boa tarde, Bia. Qual banco?') = 1, 'memoria com a fala da Mayara';
  t := mayara.confirmar_envio_proposta(v_id, true, null);
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990901') = 1, 'confirmar duas vezes nao duplica a memoria';

  -- falha de envio: vira falhou, memoria intocada
  v_id2 := (mayara.criar_proposta('+5511999990902', 'Caio Teste', null, 'Boa tarde, Caio.', '{}'::jsonb, null) ->> 'id')::bigint;
  perform mayara.aprovar_proposta(v_id2, 'x');
  t := mayara.confirmar_envio_proposta(v_id2, false, 'connection closed');
  assert (select estado from mayara.propostas_abordagem where id = v_id2) = 'falhou', 'estado falhou';
  assert (select erro from mayara.propostas_abordagem where id = v_id2) = 'connection closed', 'erro guardado';
  assert (select count(*) from public.n8n_chat_histories where session_id = 'whatsapp:escritorio:+5511999990902') = 0, 'memoria intocada na falha';

  -- aprovar proposta inexistente, descartada, expirada
  r := mayara.aprovar_proposta(999999999, 'x');
  assert (r ->> 'motivo') = 'nao_encontrada', 'inexistente: ' || r::text;
  v_id := (mayara.criar_proposta('+5511999990903', 'Duda Teste', null, 'Oi Duda', '{}'::jsonb, null) ->> 'id')::bigint;
  t := mayara.descartar_proposta(v_id);
  assert t like '%descartei%', 'descarta: ' || t;
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'nao_esta_aberta', 'descartada nao aprova: ' || r::text;
  -- descartar libera o telefone para nova proposta
  r := mayara.criar_proposta('+5511999990903', 'Duda Teste', null, 'Oi Duda de novo', '{}'::jsonb, null);
  assert (r ->> 'ok') = 'true', 'telefone liberado apos descartar: ' || r::text;
  v_id := (r ->> 'id')::bigint;
  update mayara.propostas_abordagem set expira_em = now() - interval '1 minute' where id = v_id;
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'expirada', 'expirada nao aprova: ' || r::text;

  -- lead virou sem_interesse entre a proposta e o sim
  v_id := (mayara.criar_proposta('+5511999990904', 'Edu Teste', null, 'Oi Edu', '{}'::jsonb, null) ->> 'id')::bigint;
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990904', 'Edu Teste', 'sem_interesse');
  r := mayara.aprovar_proposta(v_id, 'x');
  assert (r ->> 'motivo') = 'lead_inativo', 'sem_interesse bloqueia aprovacao: ' || r::text;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'descartada', 'proposta descartada pelo motivo';

  -- editar
  v_id := (mayara.criar_proposta('+5511999990905', 'Fabi Teste', null, 'Oi Fabi', '{}'::jsonb, null) ->> 'id')::bigint;
  r := mayara.editar_proposta(v_id, '  Boa tarde, Fabi. Qual o valor?  ');
  assert (r ->> 'ok') = 'true' and (r ->> 'texto') = 'Boa tarde, Fabi. Qual o valor?', 'edita e apara: ' || r::text;
  assert (select texto_original from mayara.propostas_abordagem where id = v_id) = 'Oi Fabi', 'guarda o original';
  r := mayara.editar_proposta(v_id, '   ');
  assert (r ->> 'motivo') = 'texto_vazio', 'edicao vazia: ' || r::text;
  r := mayara.editar_proposta(v_id, repeat('x', 701));
  assert (r ->> 'motivo') = 'texto_longo', 'edicao longa: ' || r::text;
  r := mayara.editar_proposta(v_id, 'Veja https://exemplo.com agora');
  assert (r ->> 'motivo') = 'texto_invalido', 'link barrado: ' || r::text;
  r := mayara.editar_proposta(v_id, 'Veja www.exemplo.com agora');
  assert (r ->> 'motivo') = 'texto_invalido', 'www barrado: ' || r::text;
  r := mayara.editar_proposta(999999999, 'Oi');
  assert (r ->> 'motivo') = 'nao_esta_aberta', 'editar inexistente: ' || r::text;
  -- editar reabre a notificacao (o administrador precisa ver o texto novo)
  update mayara.propostas_abordagem set notificada_em = now(), lembrete_em = now() where id = v_id;
  perform mayara.editar_proposta(v_id, 'Boa tarde, Fabi. Qual o banco?');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is not null, 'editar nao some da fila';
  assert (select lembrete_em from mayara.propostas_abordagem where id = v_id) is null, 'editar reinicia o lembrete';

  -- listar
  t := mayara.listar_propostas_abertas();
  assert t like '%#' || v_id::text || ' Fabi Teste (final 0905)%', 'lista inclui a proposta: ' || t;
  assert t not like '%5511999990905%', 'lista nao mostra o telefone completo: ' || t;

  -- proposta_sem_numero
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where estado = 'aberta' and id <> v_id;
  r := mayara.proposta_sem_numero();
  assert (r ->> 'qtd') = '1' and (r ->> 'id')::bigint = v_id and (r ->> 'bloqueada') = 'false', 'uma aberta, sem pendencia: ' || r::text;
  insert into mayara.instrucoes (texto, autor_chave) values ('Regra pendente de teste.', 't');
  r := mayara.proposta_sem_numero();
  assert (r ->> 'bloqueada') = 'true' and (r ->> 'id') is null, 'regra pendente tem prioridade: ' || r::text;
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  r := mayara.proposta_sem_numero();
  assert (r ->> 'bloqueada') = 'true', 'acao pendente tem prioridade: ' || r::text;
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_proposta('+5511999990906', 'Gui Teste', null, 'Oi Gui', '{}'::jsonb, null);
  r := mayara.proposta_sem_numero();
  assert (r ->> 'qtd') = '2' and (r ->> 'id') is null, 'duas abertas: pede o numero: ' || r::text;

  assert not has_function_privilege('anon', 'mayara.aprovar_proposta(bigint,text)', 'execute'), 'anon aprovar';
  assert not has_function_privilege('authenticated', 'mayara.confirmar_envio_proposta(bigint,boolean,text)', 'execute'), 'authenticated confirmar';
  assert not has_function_privilege('anon', 'mayara.proposta_sem_numero()', 'execute'), 'anon sem_numero';
end $t$;
rollback;
select 'OK 0035' as resultado;
