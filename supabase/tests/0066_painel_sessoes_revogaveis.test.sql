-- Rodar inteiro (execute_sql). Termina em rollback.
begin;
do $t$
declare
  h text := repeat('a', 64);
  h_expirada text := repeat('b', 64);
  agora timestamptz := timestamptz '2026-10-18 12:00:00+00';
begin
  perform painel.criar_sessao(h, agora + interval '12 hours');
  assert painel.sessao_valida(h, agora), 'sessao nova valida';
  perform painel.criar_sessao(h_expirada, agora + interval '1 hour');
  assert not painel.sessao_valida(h_expirada, agora + interval '1 hour'), 'sessao expirada invalida';
  perform painel.revogar_sessao(h, agora + interval '1 hour');
  assert not painel.sessao_valida(h, agora + interval '1 hour'), 'sessao revogada invalida';
  assert not has_table_privilege('painel_leitura', 'painel.sessoes_painel', 'select'), 'papel nao le tabela de sessoes';
  assert has_function_privilege('painel_leitura', 'painel.criar_sessao(text,timestamp with time zone)', 'execute'), 'papel cria sessao por funcao';
  assert has_function_privilege('painel_leitura', 'painel.sessao_valida(text,timestamp with time zone)', 'execute'), 'papel valida por funcao';
  assert has_function_privilege('painel_leitura', 'painel.revogar_sessao(text,timestamp with time zone)', 'execute'), 'papel revoga por funcao';
end $t$;
rollback;
select 'OK 0066' as resultado;
