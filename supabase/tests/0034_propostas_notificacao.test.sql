-- supabase/tests/0034_propostas_notificacao.test.sql
begin;
do $t$
declare
  n int; v_id bigint; r record;
  -- 12:00 em Brasilia (UTC-3) = 15:00Z
  dia_ok timestamptz := '2026-10-09 15:00:00+00';
begin
  -- 12 propostas abertas, criadas em ordem
  for i in 1..12 loop
    perform mayara.criar_proposta('+55119999908' || lpad((10 + i)::text, 2, '0'), 'Lead ' || i || ' Teste', null, 'Texto ' || i, '{}'::jsonb, null);
  end loop;
  update mayara.propostas_abordagem set expira_em = '2030-01-01 00:00:00+00' where estado = 'aberta';
  assert (select count(*) from mayara.propostas_abordagem where estado = 'aberta') = 12, '12 abertas';

  -- fora da janela: 05:59 e 21:00 de Brasilia nao reservam nada
  select count(*) into n from mayara.reservar_notificacoes('2026-10-09 08:59:00+00');
  assert n = 0, '05:59 nao notifica: ' || n;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 00:00:00+00');
  assert n = 0, '21:00 nao notifica: ' || n;
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is not null) = 0, 'nada marcado fora da janela';

  -- dentro da janela: no maximo 10, em ordem de chegada
  select count(*) into n from mayara.reservar_notificacoes(dia_ok) where tipo = 'nova';
  assert n = 10, 'limite de 10 por hora: ' || n;
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is not null) = 10, '10 marcadas';
  assert (select count(*) from mayara.propostas_abordagem where notificada_em is null and texto in ('Texto 11', 'Texto 12')) = 2, 'as duas ultimas ficam para depois';

  -- chamada repetida na mesma hora nao devolve de novo
  select count(*) into n from mayara.reservar_notificacoes(dia_ok + interval '1 minute') where tipo = 'nova';
  assert n = 0, 'nao repete na mesma hora: ' || n;

  -- hora seguinte: as 2 que sobraram
  select count(*) into n from mayara.reservar_notificacoes(dia_ok + interval '61 minutes') where tipo = 'nova';
  assert n = 2, 'sobra reservada na hora seguinte: ' || n;

  -- 20:59 de Brasilia (23:59Z) ainda notifica; 06:00 de Brasilia (09:00Z) tambem
  perform mayara.criar_proposta('+5511999990830', 'Noite Teste', null, 'Texto noite', '{}'::jsonb, null);
  update mayara.propostas_abordagem set expira_em = '2030-01-01 00:00:00+00' where estado = 'aberta';
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 00:59:00+00');
  assert n = 0, '21:59 nao notifica: ' || n;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-10 23:59:00+00') where tipo = 'nova';
  assert n = 1, '20:59 notifica: ' || n;
  perform mayara.criar_proposta('+5511999990831', 'Manha Teste', null, 'Texto manha', '{}'::jsonb, null);
  update mayara.propostas_abordagem set expira_em = '2030-01-01 00:00:00+00' where estado = 'aberta';
  select count(*) into n from mayara.reservar_notificacoes('2026-10-11 09:00:00+00') where tipo = 'nova';
  assert n = 1, '06:00 notifica: ' || n;

  -- lembrete: depois de 30 min sem resposta, uma unica vez
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 1';
  update mayara.propostas_abordagem set notificada_em = '2026-10-12 15:00:00+00', lembrete_em = null where id = v_id;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-12 15:29:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'antes de 30 min nao lembra: ' || n;
  select * into r from mayara.reservar_notificacoes('2026-10-12 15:31:00+00') where tipo = 'lembrete' and id = v_id;
  assert r.id = v_id and r.telefone_fim = '0811', 'lembra apos 30 min: ' || coalesce(r.telefone_fim, 'nulo');
  select count(*) into n from mayara.reservar_notificacoes('2026-10-12 16:30:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'lembrete uma vez so: ' || n;

  -- lembrete tambem respeita a janela
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 2';
  update mayara.propostas_abordagem set notificada_em = '2026-10-12 23:50:00+00', lembrete_em = null where id = v_id;
  select count(*) into n from mayara.reservar_notificacoes('2026-10-13 00:30:00+00') where tipo = 'lembrete' and id = v_id;
  assert n = 0, 'lembrete fora da janela espera: ' || n;

  -- expiracao
  select id into v_id from mayara.propostas_abordagem where texto = 'Texto 3';
  update mayara.propostas_abordagem set expira_em = '2026-10-09 10:00:00+00' where id = v_id;
  n := mayara.expirar_propostas('2026-10-09 11:00:00+00');
  assert n >= 1, 'expirou ao menos a vencida: ' || n;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'expirada', 'marcada expirada';
  assert (select encerrada_em from mayara.propostas_abordagem where id = v_id) is not null, 'encerrada_em preenchida';

  -- proposta expirada nao e notificada e libera o telefone para nova proposta
  select count(*) into n from mayara.reservar_notificacoes('2026-10-09 15:00:00+00') where id = v_id;
  assert n = 0, 'expirada nao notifica';

  assert not has_function_privilege('anon', 'mayara.reservar_notificacoes(timestamptz)', 'execute'), 'anon reservar';
  assert not has_function_privilege('authenticated', 'mayara.expirar_propostas(timestamptz)', 'execute'), 'authenticated expirar';
end $t$;
rollback;
select 'OK 0034' as resultado;
