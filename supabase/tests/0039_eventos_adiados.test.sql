-- supabase/tests/0039_eventos_adiados.test.sql
begin;
do $t$
declare a bigint; b bigint; c bigint; n int; n2 int; msg text;
begin
  a := mayara.adiar_evento('+55 11 99999-0901', '{"phone":"+5511999990901","message":"primeira"}'::jsonb);
  b := mayara.adiar_evento('5511999990901', '{"phone":"+5511999990901","message":"segunda"}'::jsonb);
  c := mayara.adiar_evento('+5511999990902', '{"phone":"+5511999990902","message":"terceira"}'::jsonb);
  assert (select telefone_chave from mayara.eventos_adiados where id = a) = mayara.chave_telefone('+5511999990901'), 'guarda a chave do telefone';

  select count(*) into n from mayara.reservar_eventos_adiados('2026-10-11 12:00:00-03');
  assert n = 0, 'domingo nao libera: ' || n;
  select count(*) into n from mayara.reservar_eventos_adiados('2026-10-12 12:00:00-03');
  assert n = 0, 'feriado nao libera: ' || n;
  select count(*) into n from mayara.reservar_eventos_adiados('2026-10-13 05:59:00-03');
  assert n = 0, 'antes das 06:00 nao libera: ' || n;
  assert (select count(*) from mayara.eventos_adiados where processado_em is null and id in (a, b, c)) = 3, 'nada marcado enquanto fechado';

  -- o filtro (where) e aplicado depois que a funcao ja reservou: ler tudo de uma unica chamada
  select count(*) filter (where id in (a, b)), count(*) filter (where id = c) into n, n2 from mayara.reservar_eventos_adiados('2026-10-13 06:00:00-03', 2);
  assert n = 2 and n2 = 0, 'limite 2, os dois mais antigos: ' || n || '/' || n2;
  assert (select processado_em from mayara.eventos_adiados where id = c) is null, 'o terceiro fica';

  select count(*) filter (where id in (a, b)), count(*) filter (where id = c), max(payload ->> 'message') filter (where id = c) into n, n2, msg
    from mayara.reservar_eventos_adiados('2026-10-13 06:05:00-03', 10);
  assert n = 0, 'nao repete o que ja foi reservado: ' || n;
  assert n2 = 1 and msg = 'terceira', 'libera o terceiro com o payload: ' || n2 || '/' || coalesce(msg, 'nulo');

  perform mayara.reabrir_evento_adiado(a, 'connection closed');
  assert (select processado_em from mayara.eventos_adiados where id = a) is null and (select erro from mayara.eventos_adiados where id = a) = 'connection closed', 'reabre com erro';
  select count(*) filter (where id = a) into n from mayara.reservar_eventos_adiados('2026-10-13 07:00:00-03', 10);
  assert n = 1 and (select tentativas from mayara.eventos_adiados where id = a) = 2, 'reservou de novo, 2 tentativas';
  update mayara.eventos_adiados set processado_em = null, tentativas = 5 where id = a;
  select count(*) filter (where id = a) into n from mayara.reservar_eventos_adiados('2026-10-13 08:00:00-03', 10);
  assert n = 0, 'apos 5 tentativas nao reserva mais: ' || n;

  assert not has_function_privilege('anon', 'mayara.adiar_evento(text,jsonb)', 'execute'), 'anon adiar';
  assert not has_function_privilege('authenticated', 'mayara.reservar_eventos_adiados(timestamptz,int)', 'execute'), 'authenticated reservar';
  assert not has_table_privilege('anon', 'mayara.eventos_adiados', 'select'), 'anon tabela';
end $t$;
rollback;
select 'OK 0039' as resultado;
