-- supabase/tests/0046_expediente_autorizado.test.sql
begin;
do $t$
declare n int; ca text := mayara.chave_telefone('+5511999990971'); a bigint; b bigint;
begin
  assert not mayara.resposta_permitida('2026-10-12 19:30:00-03'), 'feriado fechado';
  insert into mayara.leads_autorizados (telefone, nome, status, abordagem_ate) values
    ('+5511999990971', 'Autorizado Teste', 'ativo', '2026-10-13 12:00:00-03'), ('+5511999990972', 'Sem Autorizacao Teste', 'ativo', null);
  assert mayara.resposta_permitida_para('+5511999990971', '2026-10-12 19:30:00-03'), 'abordagem autorizada responde no feriado';
  assert not mayara.resposta_permitida_para('+5511999990972', '2026-10-12 19:30:00-03'), 'sem autorizacao continua fechado';
  assert mayara.resposta_permitida_para('+5511999990971', '2026-10-14 06:00:00-03'), 'dia util aberto';
  assert not mayara.resposta_permitida_para('+5511999990971', '2026-10-18 12:00:00-03'), 'janela de abordagem vencida e domingo: fechado';
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone_chave = ca;
  assert not mayara.resposta_permitida_para('+5511999990971', '2026-10-12 19:30:00-03'), 'quem pediu para parar nao passa';
  update mayara.leads_autorizados set status = 'ativo' where telefone_chave = ca;
  a := mayara.adiar_evento('+5511999990971', '{"message":"autorizado"}'::jsonb);
  b := mayara.adiar_evento('+5511999990972', '{"message":"sem autorizacao"}'::jsonb);
  perform mayara.reservar_eventos_adiados('2026-10-12 19:30:00-03', 50);
  assert (select processado_em from mayara.eventos_adiados where id = a) is not null, 'evento do autorizado e liberado no feriado';
  assert (select processado_em from mayara.eventos_adiados where id = b) is null, 'evento sem autorizacao continua guardado';
  perform mayara.reservar_eventos_adiados('2026-10-13 06:00:00-03', 50);
  assert (select processado_em from mayara.eventos_adiados where id = b) is not null, 'na abertura libera o restante';
  assert not has_function_privilege('anon', 'mayara.resposta_permitida_para(text,timestamptz)', 'execute'), 'anon';
end $t$;
rollback;
select 'OK 0046' as resultado;
