-- Rodar inteiro (execute_sql). Somente leitura. Ciclo sintetico: segunda 07/12/2026 09:00 de Sao Paulo.
do $t$
declare
  c timestamptz := '2026-12-07 09:00:00-03';
  conv timestamptz[]; nunca timestamptz[]; i int; n int;
begin
  select array_agg(devido_em order by etapa) into conv from mayara.agenda_followup('conversa', c) where etapa <= 14;
  select array_agg(devido_em order by etapa) into nunca from mayara.agenda_followup('nunca_respondeu', c) where etapa <= 14;
  assert array_length(conv, 1) = 14 and array_length(nunca, 1) = 14, '14 etapas em cada sequencia';

  foreach i in array array[1] loop
    assert conv[1] = '2026-12-07 11:00:00-03' and nunca[1] = '2026-12-07 11:00:00-03', 'etapa 1 e +2h';
    assert conv[2] = '2026-12-07 15:00:00-03' and nunca[2] = '2026-12-07 15:00:00-03', 'etapa 2 e +4h depois da 1 (6h do silencio), mesmo dia';
  end loop;

  assert conv[3] = '2026-12-08 10:00:00-03', 'conversa etapa 3: dia util 1, 10h';
  assert conv[4] = '2026-12-09 16:00:00-03', 'conversa etapa 4: dia util 2, 16h';
  assert conv[5] = '2026-12-10 10:00:00-03', 'conversa etapa 5: dia util 3, 10h';
  assert conv[6] = '2026-12-12 10:00:00-03', 'conversa etapa 6: dia util 5, 10h (o sabado conta como dia util de follow-up)';
  assert nunca[3] = '2026-12-08 10:00:00-03' and nunca[4] = '2026-12-09 14:00:00-03' and nunca[5] = '2026-12-10 10:00:00-03', 'nunca_respondeu etapas 3 a 5';
  assert nunca[6] = '2026-12-12 10:00:00-03', 'nunca_respondeu etapa 6: dia util 5';

  for i in 2..14 loop
    assert conv[i] > conv[i - 1] and nunca[i] > nunca[i - 1], 'datas estritamente crescentes na etapa ' || i;
  end loop;
  -- depois do primeiro dia, no maximo uma mensagem por dia
  select count(*) - count(distinct (d at time zone 'America/Sao_Paulo')::date) into n from unnest(conv[3:14]) d;
  assert n = 0, 'conversa: no maximo uma mensagem por dia a partir da etapa 3';
  select count(*) - count(distinct (d at time zone 'America/Sao_Paulo')::date) into n from unnest(nunca[3:14]) d;
  assert n = 0, 'nunca_respondeu: no maximo uma mensagem por dia a partir da etapa 3';
  assert (conv[14] at time zone 'America/Sao_Paulo')::date = (nunca[14] at time zone 'America/Sao_Paulo')::date, 'as duas sequencias terminam no mesmo dia';
  assert (conv[14] at time zone 'America/Sao_Paulo')::date - (c at time zone 'America/Sao_Paulo')::date between 25 and 38, 'a etapa 14 cai em 4 a 5 semanas';
  -- janela: todo envio dentro do horario permitido
  assert (select bool_and(mayara._janela_aberta(d, 'followup')) from unnest(conv || nunca) d), 'todos os horarios dentro da janela de follow-up';
end $t$;
select 'OK 0070' as resultado;
