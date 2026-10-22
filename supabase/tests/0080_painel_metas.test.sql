-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999990xxx); termina em rollback.
begin;
do $t$
declare
  hoje date := painel._hoje(); ini date := date_trunc('month', painel._hoje())::date; r record; falhou boolean;
  dim int := ((date_trunc('month', painel._hoje()) + interval '1 month')::date - date_trunc('month', painel._hoje())::date);
begin
  -- realizado do mes: 2 consultas marcadas no mes (+1 do mes passado), 1 contrato de 10.000 neste mes (+1 do mes passado)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em) values
    ('1199990001', 'consulta_marcada', (ini::timestamp + interval '3 hours') at time zone 'America/Sao_Paulo'),
    ('1199990002', 'consulta_marcada', (ini::timestamp + interval '5 hours') at time zone 'America/Sao_Paulo'),
    ('1199990003', 'consulta_marcada', ((ini - 1)::timestamp + interval '20 hours') at time zone 'America/Sao_Paulo');
  perform painel.contrato_registrar('+5511999990001', 'Meta A', null, 10000, ini, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 10000, 'vencimento', ini + 40)));
  perform painel.contrato_registrar('+5511999990002', 'Meta B', null, 7000, ini - 1, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 7000, 'vencimento', ini + 40)));

  perform painel.meta_definir('consultas', 10, 'teste');
  perform painel.meta_definir('contratos', 4, 'teste');
  perform painel.meta_definir('receita', 50000, 'teste');
  select * into r from painel.metas_mes() where tipo = 'consultas';
  assert r.meta = 10 and r.atual >= 2, 'consultas: meta 10, realizado do mes: ' || r::text;
  select * into r from painel.metas_mes() where tipo = 'contratos';
  assert r.meta = 4 and r.atual >= 1, 'contratos do mes: ' || r::text;
  select * into r from painel.metas_mes() where tipo = 'receita';
  assert r.meta = 50000 and r.atual >= 10000, 'receita do mes (a de 7.000 do mes passado nao entra): ' || r::text;
  assert (select atual from painel.metas_mes() where tipo = 'receita') = (select coalesce(sum(valor_total), 0) from painel.contratos where assinado_em >= ini and assinado_em < ini + dim), 'receita bate com a tabela de contratos';
  assert (select percentual from painel.metas_mes() where tipo = 'receita') = round((select atual from painel.metas_mes() where tipo = 'receita') / 50000 * 100, 1), 'percentual';
  assert (select dias_restantes from painel.metas_mes() where tipo = 'receita') = (ini + dim - 1 - hoje), 'dias restantes ate o fim do mes';
  assert (select dias_no_mes from painel.metas_mes() where tipo = 'receita') = dim, 'dias do mes';
  assert (select projecao from painel.metas_mes() where tipo = 'receita') = round((select atual from painel.metas_mes() where tipo = 'receita') / greatest(extract(day from hoje), 1) * dim, 2), 'projecao linear';
  assert (select array_agg(tipo order by ord) from (select tipo, row_number() over () ord from painel.metas_mes()) x) = array['consultas', 'contratos', 'receita'], 'ordem: consultas, contratos, receita';

  -- auditoria so quando muda
  assert (select count(*) from painel.metas_log where tipo = 'consultas' and mes = ini) = 1, 'uma linha de log';
  perform painel.meta_definir('consultas', 10, 'teste');
  assert (select count(*) from painel.metas_log where tipo = 'consultas' and mes = ini) = 1, 'mesmo valor nao duplica o log';
  perform painel.meta_definir('consultas', 12, 'teste');
  assert (select count(*) from painel.metas_log where tipo = 'consultas' and mes = ini) = 2 and (select de_valor from painel.metas_log where tipo = 'consultas' and mes = ini order by id desc limit 1) = 10, 'mudanca registra de e para';

  -- recusas
  falhou := false; begin perform painel.meta_definir('abobrinha', 5, 'teste'); exception when others then falhou := true; end; assert falhou, 'tipo invalido';
  falhou := false; begin perform painel.meta_definir('consultas', -1, 'teste'); exception when others then falhou := true; end; assert falhou, 'negativo';
  falhou := false; begin perform painel.meta_definir('consultas', 10001, 'teste'); exception when others then falhou := true; end; assert falhou, 'acima do limite';
  falhou := false; begin perform painel.meta_definir('consultas', 2.5, 'teste'); exception when others then falhou := true; end; assert falhou, 'consultas inteiras';
  falhou := false; begin perform painel.meta_definir('receita', 100000001, 'teste'); exception when others then falhou := true; end; assert falhou, 'receita acima do limite';
  falhou := false; begin perform painel.meta_definir(null, 5, 'teste'); exception when others then falhou := true; end; assert falhou, 'tipo nulo';
  perform painel.meta_definir('receita', 12345.67, 'teste');
  assert (select meta from painel.metas_mes() where tipo = 'receita') = 12345.67, 'receita aceita centavos';

  -- heranca: meta so do mes passado vale neste mes; valor 0 remove
  update painel.metas set mes = (ini - interval '1 month')::date where mes = ini and tipo = 'contratos';
  assert (select meta from painel.metas_mes() where tipo = 'contratos') = 4, 'herda a meta mais recente do mes anterior';
  perform painel.meta_definir('contratos', 0, 'teste');
  assert not exists (select 1 from painel.metas_mes() where tipo = 'contratos'), 'valor 0 remove a meta';

  assert not has_function_privilege('anon', 'painel.meta_definir(text, numeric, text)', 'execute'), 'anon sem execute';
  assert has_function_privilege('painel_leitura', 'painel.meta_definir(text, numeric, text)', 'execute'), 'painel_leitura define';
  assert has_function_privilege('painel_leitura', 'painel.metas_mes()', 'execute'), 'painel_leitura le';
end $t$;
rollback;
select 'OK 0080' as resultado;
