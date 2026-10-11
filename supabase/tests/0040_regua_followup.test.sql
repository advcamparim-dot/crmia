-- supabase/tests/0040_regua_followup.test.sql
begin;
do $t$
begin
  assert (select count(*) from mayara.regua_followup where sequencia = 'conversa') = 14, 'A tem 14 etapas';
  assert (select count(*) from mayara.regua_followup where sequencia = 'nunca_respondeu') = 40, 'B tem 40 etapas';
  assert (select valor from mayara.config where chave = 'followup_modo') = 'desligado', 'modo nasce desligado';
  assert mayara.followup_permitido('2026-10-13 06:00:00-03') and not mayara.followup_permitido('2026-10-13 05:59:00-03'), 'follow-up abre as 06:00';

  assert mayara._somar_dias_uteis('2026-10-09', 1) = '2026-10-10'::date, 'sexta +1 = sabado';
  assert mayara._somar_dias_uteis('2026-10-10', 1) = '2026-10-13'::date, 'sabado +1 = terca (domingo e feriado pulados)';
  assert mayara._somar_dias_uteis('2026-10-10', 0) = '2026-10-10'::date, '+0 = mesmo dia';

  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 1) = '2026-10-05 10:30:00-03'::timestamptz, 'A e1';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 2) = '2026-10-05 12:00:00-03'::timestamptz, 'A e2 (+1h30)';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 3) = '2026-10-05 16:00:00-03'::timestamptz, 'A e3 (+4h)';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 4) = '2026-10-06 10:00:00-03'::timestamptz, 'A e4';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 5) = '2026-10-06 16:00:00-03'::timestamptz, 'A e5';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 9) = '2026-10-08 16:00:00-03'::timestamptz, 'A e9';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 10) = '2026-10-10 10:00:00-03'::timestamptz, 'A e10 (sabado conta)';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 11) = '2026-10-14 10:00:00-03'::timestamptz, 'A e11 (pula domingo e feriado)';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') where etapa = 14) = '2026-10-21 10:00:00-03'::timestamptz, 'A e14';

  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-09 18:45:00-03') where etapa = 1) = '2026-10-10 06:00:00-03'::timestamptz, 'A e1 adiada para a abertura';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-09 18:45:00-03') where etapa = 3) = '2026-10-10 11:30:00-03'::timestamptz, 'A e3 encadeada apos a abertura';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-09 18:45:00-03') where etapa = 4) = '2026-10-13 10:00:00-03'::timestamptz, 'A e4: sabado +1 = terca';

  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-10 15:13:00-03') where etapa = 2) = '2026-10-10 17:13:00-03'::timestamptz, 'Claudemiro e2';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-10 15:13:00-03') where etapa = 3) = '2026-10-13 06:00:00-03'::timestamptz, 'Claudemiro e3 vai para terca 06:00';
  assert (select devido_em from mayara.agenda_followup('conversa', '2026-10-10 15:13:00-03') where etapa = 4) = '2026-10-14 10:00:00-03'::timestamptz, 'Claudemiro e4 (referencia = terca)';

  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 3) = '2026-10-08 13:01:00-03'::timestamptz, 'Gilberto e3';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 4) = '2026-10-09 10:00:00-03'::timestamptz, 'Gilberto e4';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 6) = '2026-10-10 14:00:00-03'::timestamptz, 'Gilberto e6 (dia 2, 14h, sabado)';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 7) = '2026-10-13 10:00:00-03'::timestamptz, 'Gilberto e7';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 13) = '2026-10-20 10:00:00-03'::timestamptz, 'Gilberto e13';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 14) = '2026-10-22 10:00:00-03'::timestamptz, 'Gilberto e14 (a cada 2 dias)';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') where etapa = 15) = '2026-10-24 10:00:00-03'::timestamptz, 'Gilberto e15';

  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-10 08:18:16-03') where etapa = 3) = '2026-10-10 14:18:16-03'::timestamptz, 'Cristina e3';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-10 08:18:16-03') where etapa = 4) = '2026-10-13 10:00:00-03'::timestamptz, 'Cristina e4';
  assert (select devido_em from mayara.agenda_followup('nunca_respondeu', '2026-10-10 08:18:16-03') where etapa = 6) = '2026-10-14 14:00:00-03'::timestamptz, 'Cristina e6';

  assert not exists (select 1 from mayara.agenda_followup('conversa', '2026-10-05 10:00:00-03') a where not mayara.followup_permitido(a.devido_em)), 'A: tudo dentro da janela';
  assert not exists (select 1 from mayara.agenda_followup('nunca_respondeu', '2026-10-08 07:01:00-03') a where not mayara.followup_permitido(a.devido_em)), 'B: tudo dentro da janela';
  assert not has_function_privilege('anon', 'mayara.agenda_followup(text,timestamptz)', 'execute'), 'anon agenda';
  assert not has_table_privilege('anon', 'mayara.followup_estado', 'select'), 'anon estado';
end $t$;
rollback;
select 'OK 0040' as resultado;
