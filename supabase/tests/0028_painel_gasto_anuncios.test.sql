-- supabase/tests/0028_painel_gasto_anuncios.test.sql
begin;
do $t$
declare r jsonb;
begin
  r := painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-10-17', 1500.50);
  assert (r ->> 'mes') = '2026-10-01', 'normaliza o mes para o dia 1: ' || r::text;
  assert (select valor from painel.gasto_anuncios) = 1500.50, 'guarda o valor';

  r := painel.registrar_gasto('  [mf] gestão de passivo ', '2026-10-01', 2000);
  assert (select count(*) from painel.gasto_anuncios) = 1, 'nao duplica';
  assert (select valor from painel.gasto_anuncios) = 2000, 'atualiza o valor';

  perform painel.registrar_gasto('[MF] GESTÃO DE PASSIVO', '2026-11-05', 900);
  assert (select count(*) from painel.gasto_anuncios) = 2, 'outro mes';

  begin perform painel.registrar_gasto('X', '2026-10-01', 0); assert false, 'zero deveria falhar';
  exception when check_violation then null; end;
  begin perform painel.registrar_gasto('X', '2026-10-01', -5); assert false, 'negativo deveria falhar';
  exception when check_violation then null; end;
  begin perform painel.registrar_gasto('   ', '2026-10-01', 10); assert false, 'campanha vazia deveria falhar';
  exception when check_violation then null; end;

  assert not has_function_privilege('anon', 'painel.registrar_gasto(text,date,numeric)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('painel_leitura', 'painel.registrar_gasto(text,date,numeric)', 'execute'), 'leitura nao grava';
  assert not has_table_privilege('painel_leitura', 'painel.gasto_anuncios', 'insert'), 'leitura sem insert';
end $t$;
rollback;
select 'OK 0028' as resultado;
