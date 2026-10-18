-- Rodar inteiro (execute_sql). Termina em rollback.
begin;
do $t$
declare h1 text := repeat('a', 64); h2 text := repeat('b', 64); h3 text := repeat('c', 64); id1 uuid;
begin
  id1 := painel.sessao_criar(h1, now() + interval '12 hours');
  assert id1 is not null, 'criar devolve o id';
  assert painel.sessao_valida(h1) = true, 'sessao recem criada e valida';
  assert painel.sessao_valida(repeat('e', 64)) = false, 'hash desconhecido e invalido';
  assert painel.sessao_valida(null) = false and painel.sessao_valida('') = false, 'nulo e vazio sao invalidos';

  perform painel.sessao_criar(h2, now() - interval '1 minute');
  assert painel.sessao_valida(h2) = false, 'sessao expirada e invalida';

  perform painel.sessao_criar(h3, now() + interval '12 hours');
  assert painel.sessao_valida(h3) = true, 'antes de revogar e valida';
  perform painel.sessao_revogar(h3);
  assert painel.sessao_valida(h3) = false, 'sessao revogada e invalida';
  perform painel.sessao_revogar(h3);
  perform painel.sessao_revogar(repeat('f', 64));
  assert painel.sessao_valida(h1) = true, 'revogar outra sessao nao afeta esta';

  begin
    perform painel.sessao_criar('curto', now() + interval '1 hour');
    assert false, 'hash fora do formato deveria ser recusado';
  exception when others then
    assert sqlerrm like '%hash%', 'mensagem de erro do hash: ' || sqlerrm;
  end;

  assert not has_function_privilege('anon', 'painel.sessao_valida(text)', 'execute'), 'anon sem execute em valida';
  assert not has_function_privilege('authenticated', 'painel.sessao_criar(text, timestamptz)', 'execute'), 'authenticated sem execute em criar';
  assert not has_table_privilege('anon', 'painel.sessoes', 'select'), 'anon sem select na tabela';
  assert (select relrowsecurity from pg_class where oid = 'painel.sessoes'::regclass), 'RLS ligada';
end $t$;
rollback;
select 'OK 0065' as resultado;
