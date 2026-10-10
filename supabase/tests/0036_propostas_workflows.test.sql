-- supabase/tests/0036_propostas_workflows.test.sql
begin;
do $t$
declare r jsonb; v_id bigint; v_id2 bigint; t text;
begin
  -- contexto_central: chaves novas, sem quebrar as antigas
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'pendente') = 'false' and (r ->> 'acao_pendente') = 'false', 'sem pendencias: ' || r::text;
  assert (r ->> 'propostas_abertas') = '0' and (r -> 'proposta_unica') = 'null'::jsonb, 'sem propostas: ' || r::text;
  assert r ? 'exclusivo', 'mantem exclusivo';

  v_id := (mayara.criar_proposta('+5511999990901', 'Ana Teste', 'crm-a1', 'Boa tarde, Ana. Aqui é a Mayara. Com qual banco é esse contrato?', '{"valorAproximado":"50 mil"}'::jsonb, 'banco') ->> 'id')::bigint;
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'propostas_abertas') = '1' and (r ->> 'proposta_unica')::bigint = v_id, 'uma proposta: ' || r::text;
  v_id2 := (mayara.criar_proposta('+5511999990902', 'Beto Teste', null, 'Boa tarde, Beto. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  r := mayara.contexto_central('5514997022609');
  assert (r ->> 'propostas_abertas') = '2' and (r -> 'proposta_unica') = 'null'::jsonb, 'duas propostas: ' || r::text;

  -- decidir: listar, descartar, editar, aprovar
  r := mayara.decidir_proposta('listar', null, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%#' || v_id::text || ' Ana Teste (final 0901)%', 'listar: ' || r::text;
  r := mayara.decidir_proposta('descartar', v_id2, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%descartei%', 'descartar: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, '  Boa tarde, Ana. Aqui é a Mayara. Qual o banco do contrato?  ', 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Qual o banco do contrato?%' and (r ->> 'resposta') like '%sim ' || v_id::text || '%', 'editar: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, 'Veja https://x.com', 'x');
  assert (r ->> 'resposta') like '%link%', 'editar com link: ' || r::text;
  r := mayara.decidir_proposta('editar', v_id, '   ', 'x');
  assert (r ->> 'resposta') like '%editar%', 'editar vazio: ' || r::text;
  r := mayara.decidir_proposta('editar', 999999999, 'Oi', 'x');
  assert (r ->> 'resposta') like '%Não achei%' or (r ->> 'resposta') like '%não está aberta%', 'editar inexistente: ' || r::text;
  r := mayara.decidir_proposta('aprovar', null, null, 'x');
  assert (r ->> 'resposta') like '%número da proposta%', 'sem numero: ' || r::text;
  r := mayara.decidir_proposta('aprovar', 999999999, null, 'x');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%Não achei%', 'aprovar inexistente: ' || r::text;
  r := mayara.decidir_proposta('aprovar', v_id, null, '5514997022609');
  assert (r ->> 'acao') = 'enviar' and (r ->> 'destino') = '+5511999990901' and (r ->> 'texto') = 'Boa tarde, Ana. Aqui é a Mayara. Qual o banco do contrato?' and (r ->> 'crm_lead_id') = 'crm-a1' and (r ->> 'id')::bigint = v_id, 'aprovar: ' || r::text;
  r := mayara.decidir_proposta('aprovar', v_id, null, '5514997022609');
  assert (r ->> 'acao') = 'responder' and (r ->> 'resposta') like '%já foi aprovada%', 'aprovar de novo: ' || r::text;
  r := mayara.decidir_proposta('xyz', v_id, null, 'x');
  assert (r ->> 'resposta') like '%Não entendi%', 'operacao desconhecida: ' || r::text;

  -- finalizar envio: sucesso e falha
  t := mayara.finalizar_envio_proposta(v_id, true, null);
  assert t like '%Enviei a mensagem para Ana Teste (final 0901)%', 'envio ok: ' || t;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'enviada', 'estado enviada';
  v_id2 := (mayara.criar_proposta('+5511999990903', 'Caio Teste', null, 'Boa tarde, Caio. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  perform mayara.decidir_proposta('aprovar', v_id2, null, 'x');
  t := mayara.finalizar_envio_proposta(v_id2, false, 'connection closed');
  assert t like '%Não consegui enviar para Caio Teste (final 0903)%' and t like '%connection closed%', 'envio falhou: ' || t;
  assert (select estado from mayara.propostas_abordagem where id = v_id2) = 'falhou', 'estado falhou';

  -- liberar notificacao
  v_id := (mayara.criar_proposta('+5511999990904', 'Duda Teste', null, 'Boa tarde, Duda. Aqui é a Mayara. Qual banco?', '{}'::jsonb, 'banco') ->> 'id')::bigint;
  update mayara.propostas_abordagem set notificada_em = now(), lembrete_em = now() where id = v_id;
  perform mayara.liberar_notificacao(v_id, 'lembrete');
  assert (select lembrete_em from mayara.propostas_abordagem where id = v_id) is null and (select notificada_em from mayara.propostas_abordagem where id = v_id) is not null, 'libera so o lembrete';
  perform mayara.liberar_notificacao(v_id, 'nova');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is null, 'libera a notificacao nova';
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where id = v_id;
  perform mayara.liberar_notificacao(v_id, 'nova');
  assert (select notificada_em from mayara.propostas_abordagem where id = v_id) is null, 'proposta encerrada nao e reaberta';

  -- regra ou acao pendente aparece no contexto
  insert into mayara.instrucoes (texto, autor_chave) values ('Regra pendente de teste.', 't');
  assert (mayara.contexto_central('x') ->> 'pendente') = 'true', 'regra pendente no contexto';
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where estado = 'pendente';
  perform mayara.criar_acao_pendente('pausar', '{}'::jsonb, 'Pausar a Mayara', '5514997022609');
  assert (mayara.contexto_central('x') ->> 'acao_pendente') = 'true', 'acao pendente no contexto';
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';

  assert not has_function_privilege('anon', 'mayara.decidir_proposta(text,bigint,text,text)', 'execute'), 'anon decidir';
  assert not has_function_privilege('authenticated', 'mayara.finalizar_envio_proposta(bigint,boolean,text)', 'execute'), 'authenticated finalizar';
  assert not has_function_privilege('anon', 'mayara.liberar_notificacao(bigint,text)', 'execute'), 'anon liberar';
end $t$;
rollback;
select 'OK 0036' as resultado;
