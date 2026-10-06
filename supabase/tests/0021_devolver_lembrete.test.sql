-- supabase/tests/0021_devolver_lembrete.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

do $t$
declare r boolean;
begin
  insert into mayara.session_state (session_key, lembrete_consulta_estagio) values ('t-lembrete', '1h');

  -- envio falhou: o estagio reservado volta para 'nenhum' e o lembrete pode ser tentado de novo
  r := mayara.devolver_lembrete('t-lembrete', '1h');
  assert r = true, 'devolve quando o estagio confere';
  assert (select lembrete_consulta_estagio from mayara.session_state where session_key = 't-lembrete') = 'nenhum', 'estagio volta para nenhum';

  -- nao mexe se o estagio ja mudou (outro lembrete mais novo foi reservado)
  update mayara.session_state set lembrete_consulta_estagio = '15min' where session_key = 't-lembrete';
  r := mayara.devolver_lembrete('t-lembrete', '1h');
  assert r = false, 'nao devolve estagio diferente';
  assert (select lembrete_consulta_estagio from mayara.session_state where session_key = 't-lembrete') = '15min', 'mantem o estagio mais novo';

  -- sessao inexistente
  assert mayara.devolver_lembrete('nao-existe', '1h') = false, 'sessao inexistente';

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.devolver_lembrete(text,text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.devolver_lembrete(text,text)', 'execute'), 'authenticated sem execute';
end $t$;

rollback;
select 'OK 0021' as resultado;
