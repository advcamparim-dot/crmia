-- Rodar inteiro (execute_sql). Termina em rollback.
begin;
do $t$
declare id1 bigint; id2 bigint; id3 bigint;
begin
  id1 := painel.registrar_falha_agendamento('+5511999991201', 'erro_desconhecido');
  assert id1 is not null, 'registra e devolve o id';
  assert (select telefone_chave from painel.falhas_agendamento where id = id1) = mayara.chave_telefone('+5511999991201'), 'guarda a chave do telefone, nao o numero cru';
  assert (select resolvida_em from painel.falhas_agendamento where id = id1) is null, 'nasce em aberto';

  id2 := painel.registrar_falha_agendamento('+5511999991201', 'erro_desconhecido');
  assert id2 = id1, 'segunda chamada em 10 minutos devolve o mesmo id';
  assert (select count(*) from painel.falhas_agendamento where telefone_chave = mayara.chave_telefone('+5511999991201')) = 1, 'nao duplica';

  id2 := painel.registrar_falha_agendamento('+551199991201', 'outro');
  assert id2 = id1, 'variante do telefone e o mesmo lead';

  update painel.falhas_agendamento set criada_em = now() - interval '11 minutes' where id = id1;
  id3 := painel.registrar_falha_agendamento('+5511999991201', 'erro_desconhecido');
  assert id3 <> id1, 'depois de 10 minutos cria outra';

  assert painel.registrar_falha_agendamento('+5511999991202', null) is not null, 'motivo nulo aceito';
  assert (select motivo from painel.falhas_agendamento where telefone_chave = mayara.chave_telefone('+5511999991202')) = 'desconhecido', 'motivo nulo vira desconhecido';

  begin perform painel.registrar_falha_agendamento('123', 'x'); assert false, 'telefone invalido deveria ser recusado';
  exception when others then assert sqlerrm like '%telefone%', 'mensagem: ' || sqlerrm; end;
  begin perform painel.registrar_falha_agendamento(null, 'x'); assert false, 'telefone nulo deveria ser recusado';
  exception when others then assert sqlerrm like '%telefone%', 'mensagem nulo: ' || sqlerrm; end;

  perform painel.registrar_falha_agendamento('+5511999991203', repeat('x', 500));
  assert (select char_length(motivo) from painel.falhas_agendamento where telefone_chave = mayara.chave_telefone('+5511999991203')) <= 200, 'motivo limitado a 200 caracteres';

  assert not has_function_privilege('anon', 'painel.registrar_falha_agendamento(text, text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'painel.registrar_falha_agendamento(text, text)', 'execute'), 'authenticated sem execute';
  assert not has_table_privilege('anon', 'painel.falhas_agendamento', 'select'), 'anon sem select na tabela';
  assert (select relrowsecurity from pg_class where oid = 'painel.falhas_agendamento'::regclass), 'RLS ligada';
end $t$;
rollback;
select 'OK 0067' as resultado;
