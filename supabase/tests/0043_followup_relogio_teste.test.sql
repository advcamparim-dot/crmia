-- supabase/tests/0043_followup_relogio_teste.test.sql
-- Depende dos leads reais de 10/10 (Gilberto, Cristina, Claudemiro): e um teste de conferencia, nao de fixture.
begin;
do $t$
declare n int; v_log bigint; j jsonb;
begin
  assert (select valor from mayara.config where chave = 'followup_relogio_teste') = '', 'nasce vazio';
  assert mayara._relogio('2026-10-05 12:00:00-03') = '2026-10-05 12:00:00-03'::timestamptz, 'vazio: usa o horario recebido';
  update mayara.config set valor = '2026-10-13 06:00:00-03' where chave = 'followup_relogio_teste';
  assert mayara._relogio(now()) = '2026-10-13 06:00:00-03'::timestamptz, 'com valor: usa o relogio de teste';
  update mayara.config set valor = 'simulacao' where chave = 'followup_modo';
  select count(*) into n from mayara.reservar_followups(now(), 10);
  assert n = 3, 'com o relogio em terca 06:00 reserva Gilberto, Cristina e Claudemiro: ' || n;
  select id into v_log from mayara.followups_log where estado = 'reservado' order by id limit 1;
  j := mayara.followup_ainda_valido(v_log, now());
  assert (j ->> 'ok') = 'true', 'revalida com o mesmo relogio: ' || j::text;
  update mayara.config set valor = '' where chave = 'followup_relogio_teste';
  j := mayara.followup_ainda_valido(v_log, '2026-10-11 12:00:00-03');
  assert (j ->> 'motivo') = 'fora_janela', 'sem relogio de teste o domingo e fechado: ' || j::text;
end $t$;
rollback;
select 'OK 0043' as resultado;
