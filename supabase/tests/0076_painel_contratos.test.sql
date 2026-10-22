-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999986xxx); termina em rollback.
begin;
do $t$
declare
  hoje date := painel._hoje(); id1 bigint; id2 bigint; falhou boolean; parcelas jsonb; n int; pid bigint;
begin
  -- exemplo do Dr. Santo corrigido: entrada 5.000 paga + 12 x 1.600 = 24.200
  select jsonb_agg(x order by (x ->> 'numero')::int) into parcelas from (
    select jsonb_build_object('numero', 0, 'valor', 5000, 'vencimento', hoje, 'pago_em', hoje) x
    union all
    select jsonb_build_object('numero', k, 'valor', 1600, 'vencimento', (date '2026-11-20' + make_interval(months => k - 1))::date) from generate_series(1, 12) k) q;
  id1 := painel.contrato_registrar('+5511999986001', 'Cliente Teste', 'C-1', 24200, hoje, parcelas, 'whatsapp');
  assert id1 is not null, 'registrou';
  assert (select count(*) from painel.parcelas where contrato_id = id1) = 13, '13 parcelas (entrada + 12)';
  assert (select sum(valor) from painel.parcelas where contrato_id = id1) = 24200, 'soma das parcelas = total';
  assert (select pago_em from painel.parcelas where contrato_id = id1 and numero = 0) = hoje, 'entrada paga';
  assert (select max(vencimento) from painel.parcelas where contrato_id = id1) = date '2027-10-20', 'ultima parcela em 20/10/2027';
  assert (select min(vencimento) from painel.parcelas where contrato_id = id1 and numero = 1) = date '2026-11-20', 'primeira parcela em 20/11/2026';

  -- idempotente
  id2 := painel.contrato_registrar('+5511999986001', 'Cliente Teste', 'C-1', 24200, hoje, parcelas, 'whatsapp');
  assert id2 = id1, 'mesma frase em 10 min devolve o mesmo contrato';
  assert (select count(*) from painel.contratos where lead_chave = mayara.chave_telefone('+5511999986001')) = 1, 'um so contrato';

  -- soma nao bate (24.000 contra 24.200) e por 1 centavo
  falhou := false; begin perform painel.contrato_registrar('+5511999986002', 'Soma', null, 24000, hoje, parcelas, 'whatsapp'); exception when others then falhou := sqlerrm like 'soma_nao_bate%'; end;
  assert falhou, 'soma diferente em R$ 200 e recusada com a diferenca';
  falhou := false; begin perform painel.contrato_registrar('+5511999986002', 'Soma', null, 24200.01, hoje, parcelas, 'whatsapp'); exception when others then falhou := true; end;
  assert falhou, 'soma diferente em 1 centavo e recusada';
  assert not exists (select 1 from painel.contratos where lead_chave = mayara.chave_telefone('+5511999986002')), 'nada gravado quando recusa';

  -- limites
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 0, hoje, '[{"numero":1,"valor":0,"vencimento":"2026-12-01"}]'::jsonb); exception when others then falhou := true; end;
  assert falhou, 'total zero recusado';
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 100, hoje, '[{"numero":1,"valor":-100,"vencimento":"2026-12-01"},{"numero":2,"valor":200,"vencimento":"2026-12-02"}]'::jsonb); exception when others then falhou := true; end;
  assert falhou, 'parcela negativa recusada';
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 5000001, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 5000001, 'vencimento', hoje + 30))); exception when others then falhou := true; end;
  assert falhou, 'total acima de 5 milhoes recusado';
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 100, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 100, 'vencimento', hoje + interval '11 years'))); exception when others then falhou := true; end;
  assert falhou, 'vencimento a mais de 10 anos recusado';
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 100, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 100, 'vencimento', hoje + 5, 'pago_em', hoje + 3))); exception when others then falhou := true; end;
  assert falhou, 'pagamento no futuro recusado';
  falhou := false; begin perform painel.contrato_registrar('nao e telefone', 'x', null, 100, hoje, jsonb_build_array(jsonb_build_object('numero', 1, 'valor', 100, 'vencimento', hoje + 5))); exception when others then falhou := true; end;
  assert falhou, 'telefone invalido recusado';
  select jsonb_agg(jsonb_build_object('numero', k, 'valor', 1, 'vencimento', hoje + k)) into parcelas from generate_series(1, 122) k;
  falhou := false; begin perform painel.contrato_registrar('+5511999986003', 'x', null, 122, hoje, parcelas); exception when others then falhou := true; end;
  assert falhou, 'mais de 121 parcelas recusado';

  -- centavos sem erro de ponto flutuante: 12 x 1.600,10 = 19.201,20
  select jsonb_agg(jsonb_build_object('numero', k, 'valor', 1600.10, 'vencimento', hoje + 30 * k)) into parcelas from generate_series(1, 12) k;
  assert painel.contrato_registrar('+5511999986004', 'Centavos', null, 19201.20, hoje, parcelas) is not null, '12 x 1.600,10 soma 19.201,20 exato';

  -- status automatico
  assert painel.parcela_status(null, hoje + 1, hoje) = 'a_receber', 'antes do vencimento: a receber';
  assert painel.parcela_status(null, hoje, hoje) = 'a_receber', 'vence hoje: ainda nao esta atrasada';
  assert painel.parcela_status(null, hoje - 1, hoje) = 'atrasada', 'dia seguinte ao vencimento: atrasada';
  assert painel.parcela_status(hoje, hoje - 30, hoje) = 'paga', 'paga ganha de atrasada';

  -- marcar e desfazer pagamento
  select id into pid from painel.parcelas where contrato_id = id1 and numero = 1;
  falhou := false; begin perform painel.parcela_marcar_paga(pid, hoje + 1, 'teste'); exception when others then falhou := true; end;
  assert falhou, 'marcar paga com data futura recusado';
  perform painel.parcela_marcar_paga(pid, hoje, 'teste');
  assert (select pago_em from painel.parcelas where id = pid) = hoje, 'marcada como paga';
  perform painel.parcela_marcar_paga(pid, hoje, 'teste');
  assert (select count(*) from painel.parcelas_log where parcela_id = pid and acao = 'marcar_paga') = 1, 'marcar duas vezes a mesma data nao duplica o log';
  perform painel.parcela_desfazer(pid, 'teste');
  assert (select pago_em from painel.parcelas where id = pid) is null, 'desfeito: volta ao automatico';
  perform painel.parcela_desfazer(pid, 'teste');
  assert (select count(*) from painel.parcelas_log where parcela_id = pid) = 2, 'log: marcar e desfazer (desfazer repetido nao duplica)';
  falhou := false; begin perform painel.parcela_marcar_paga(-1, hoje, 'teste'); exception when others then falhou := true; end;
  assert falhou, 'parcela inexistente recusada';

  assert not has_function_privilege('anon', 'painel.contrato_registrar(text, text, text, numeric, date, jsonb, text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('painel_leitura', 'painel.contrato_registrar(text, text, text, numeric, date, jsonb, text)', 'execute'), 'painel_leitura nao registra contrato';
  assert has_function_privilege('painel_leitura', 'painel.parcela_marcar_paga(bigint, date, text)', 'execute'), 'painel_leitura marca pagamento';
  assert has_function_privilege('painel_leitura', 'painel.parcela_desfazer(bigint, text)', 'execute'), 'painel_leitura desfaz pagamento';
end $t$;
rollback;
select 'OK 0076' as resultado;
