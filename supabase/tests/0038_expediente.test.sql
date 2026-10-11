-- supabase/tests/0038_expediente.test.sql
begin;
do $t$
begin
  -- dia util: resposta 06:00-21:00, follow-up 06:00-19:00 (segunda 2026-10-05)
  assert not mayara.resposta_permitida('2026-10-05 05:59:00-03'), 'seg 05:59 fechado';
  assert mayara.resposta_permitida('2026-10-05 06:00:00-03'), 'seg 06:00 aberto';
  assert mayara.resposta_permitida('2026-10-05 20:59:00-03'), 'seg 20:59 aberto';
  assert not mayara.resposta_permitida('2026-10-05 21:00:00-03'), 'seg 21:00 fechado';
  assert not mayara.followup_permitido('2026-10-05 05:59:00-03'), 'follow-up seg 05:59 fechado';
  assert mayara.followup_permitido('2026-10-05 06:00:00-03'), 'follow-up seg 06:00 aberto';
  assert mayara.followup_permitido('2026-10-05 18:59:00-03'), 'follow-up seg 18:59 aberto';
  assert not mayara.followup_permitido('2026-10-05 19:00:00-03'), 'follow-up seg 19:00 fechado';

  -- sabado ate as 18h (2026-10-10)
  assert mayara.resposta_permitida('2026-10-10 17:59:00-03'), 'sab 17:59 resposta aberto';
  assert not mayara.resposta_permitida('2026-10-10 18:00:00-03'), 'sab 18:00 resposta fechado';
  assert mayara.followup_permitido('2026-10-10 17:59:00-03'), 'sab 17:59 follow-up aberto';
  assert not mayara.followup_permitido('2026-10-10 18:00:00-03'), 'sab 18:00 follow-up fechado';
  assert mayara.resposta_permitida('2026-10-10 06:00:00-03'), 'sab 06:00 resposta aberto';

  -- domingo e feriados nacionais
  assert not mayara.resposta_permitida('2026-10-11 12:00:00-03') and not mayara.followup_permitido('2026-10-11 12:00:00-03'), 'domingo fechado';
  assert not mayara.resposta_permitida('2026-10-12 12:00:00-03'), 'feriado 12/10 (segunda) fechado';
  assert not mayara.resposta_permitida('2026-04-03 12:00:00-03'), 'sexta-feira santa 2026';
  assert not mayara.resposta_permitida('2027-03-26 12:00:00-03'), 'sexta-feira santa 2027';
  assert not mayara.resposta_permitida('2028-04-14 12:00:00-03'), 'sexta-feira santa 2028';
  assert not mayara.resposta_permitida('2029-03-30 12:00:00-03'), 'sexta-feira santa 2029';
  assert not mayara.resposta_permitida('2030-04-19 12:00:00-03'), 'sexta-feira santa 2030';
  assert not mayara.resposta_permitida('2026-11-20 12:00:00-03'), 'consciencia negra';
  assert not mayara.resposta_permitida('2026-11-02 12:00:00-03'), 'finados';
  assert not mayara.resposta_permitida('2026-12-25 12:00:00-03'), 'natal';
  assert not mayara.resposta_permitida('2027-01-01 12:00:00-03'), 'ano novo';
  assert not mayara.resposta_permitida('2026-09-07 12:00:00-03'), 'independencia';
  assert mayara.resposta_permitida('2026-10-13 12:00:00-03'), 'terca normal aberta';

  -- fuso: 23:30 UTC de segunda ainda e segunda 20:30 em Brasilia (aberto); 00:30 UTC de terca e segunda 21:30 (fechado)
  assert mayara.resposta_permitida('2026-10-06 23:30:00+00'), 'fuso: 20:30 BRT aberto';
  assert not mayara.resposta_permitida('2026-10-07 00:30:00+00'), 'fuso: 21:30 BRT fechado';

  -- proxima abertura (resposta)
  assert mayara.proxima_abertura('2026-10-10 19:00:00-03') = '2026-10-13 06:00:00-03'::timestamptz, 'sab 19h -> domingo fechado, segunda feriado -> terca 06:00';
  assert mayara.proxima_abertura('2026-10-13 05:00:00-03') = '2026-10-13 06:00:00-03'::timestamptz, 'antes de abrir -> abre no mesmo dia';
  assert mayara.proxima_abertura('2026-10-13 12:00:00-03') = '2026-10-13 12:00:00-03'::timestamptz, 'aberto -> agora';
  assert mayara.proxima_abertura('2026-10-13 22:00:00-03') = '2026-10-14 06:00:00-03'::timestamptz, 'noite -> proximo dia 06:00';
  assert mayara.proxima_abertura('2026-10-09 22:00:00-03') = '2026-10-10 06:00:00-03'::timestamptz, 'sexta noite -> sabado 06:00';

  -- proxima abertura (follow-up)
  assert mayara.proxima_abertura('2026-10-09 19:30:00-03', 'followup') = '2026-10-10 06:00:00-03'::timestamptz, 'sexta 19:30 -> sabado 06:00';
  assert mayara.proxima_abertura('2026-10-10 18:30:00-03', 'followup') = '2026-10-13 06:00:00-03'::timestamptz, 'sabado 18:30 -> terca 06:00';
  assert mayara.proxima_abertura('2026-10-13 05:00:00-03', 'followup') = '2026-10-13 06:00:00-03'::timestamptz, 'antes de 06:00 -> 06:00';

  assert not has_function_privilege('anon', 'mayara.resposta_permitida(timestamptz)', 'execute'), 'anon resposta';
  assert not has_function_privilege('authenticated', 'mayara.proxima_abertura(timestamptz,text)', 'execute'), 'authenticated proxima';
  assert not has_table_privilege('anon', 'mayara.feriados_nacionais', 'select'), 'anon feriados';
  assert (select count(*) from mayara.feriados_nacionais) = 50, 'feriados 2026-2030: ' || (select count(*) from mayara.feriados_nacionais);
end $t$;
rollback;
select 'OK 0038' as resultado;
