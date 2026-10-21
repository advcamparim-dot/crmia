begin;
do $t$
declare
  v_id bigint;
  v_id_repetido bigint;
  v_reserva record;
  v_reservas int;
  v_resumo text;
begin
  -- Esta mudanca deve falhar se criar_handoff_consulta deixar de deduplicar
  -- pelo evento de agenda ou se aceitar uma sessao sem lead.
  insert into mayara.session_state (
    session_key, phone, estado, consulta_agendada_em, fatos_json
  ) values (
    'whatsapp:escritorio:+5511999990621',
    '+5511999990621',
    'S6_AGENDADO',
    timestamptz '2026-10-20 13:00:00+00',
    '{"nomeCompleto":"Lead Consulta Teste","tipoDivida":"capital de giro","situacaoJudicial":"recebeu citacao","honorarios":"nao incluir","diagnostico":"nao incluir"}'::jsonb
  );

  v_id := mayara.criar_handoff_consulta(
    'whatsapp:escritorio:+5511999990621',
    'evento-consulta-teste-0621',
    timestamptz '2026-10-20 13:00:00+00'
  );
  v_id_repetido := mayara.criar_handoff_consulta(
    'whatsapp:escritorio:+5511999990621',
    'evento-consulta-teste-0621',
    timestamptz '2026-10-20 13:00:00+00'
  );

  assert v_id is not null and v_id = v_id_repetido, 'a mesma consulta precisa produzir o mesmo handoff';
  assert (select count(*) from mayara.handoffs_consulta where evento_calendario_id = 'evento-consulta-teste-0621') = 1,
    'nao pode duplicar handoff por evento';
  assert (select status from mayara.handoffs_consulta where id = v_id) = 'pendente', 'handoff novo pendente';

  select resumo::text into v_resumo from mayara.handoffs_consulta where id = v_id;
  assert v_resumo like '%Lead Consulta Teste%' and v_resumo like '%capital de giro%' and v_resumo like '%recebeu citacao%',
    'resumo deve conter somente fatos essenciais: ' || coalesce(v_resumo, 'null');
  assert v_resumo not ilike '%honor%' and v_resumo not ilike '%diagnost%',
    'resumo nao pode conter honorarios ou diagnostico: ' || coalesce(v_resumo, 'null');

  assert mayara.criar_handoff_consulta(
    'whatsapp:escritorio:+5511999990699',
    'evento-sem-lead-0621',
    timestamptz '2026-10-20 13:00:00+00'
  ) is null, 'sessao sem lead nao gera handoff';
  assert not exists (select 1 from mayara.handoffs_consulta where evento_calendario_id = 'evento-sem-lead-0621'),
    'sem lead nao deixa registro';

  select * into v_reserva from mayara.reservar_handoffs_consulta(1, now());
  assert v_reserva.id = v_id and v_reserva.telefone_final = '0621', 'reserva devolve apenas dados minimos';
  select count(*) into v_reservas from mayara.reservar_handoffs_consulta(1, now());
  assert v_reservas = 0, 'reserva atomica nao devolve a mesma linha duas vezes';

  perform mayara.concluir_handoff_consulta(v_id, false, 'telegram indisponivel');
  assert (select status from mayara.handoffs_consulta where id = v_id) = 'falhou', 'falha fica auditavel';
  assert (select tentativas from mayara.handoffs_consulta where id = v_id) = 1, 'falha conta tentativa';

  assert not has_function_privilege('anon', 'mayara.criar_handoff_consulta(text,text,timestamptz)', 'execute'), 'anon sem criar handoff';
  assert not has_function_privilege('authenticated', 'mayara.reservar_handoffs_consulta(integer,timestamptz)', 'execute'), 'authenticated sem reservar';
end $t$;
rollback;
select 'OK 0062' as resultado;
