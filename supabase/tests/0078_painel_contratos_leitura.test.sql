-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999988xxx); termina em rollback.
begin;
do $t$
declare
  hoje date := painel._hoje(); c1 bigint; c2 bigint; r record; de timestamptz; ate timestamptz; pid bigint; colunas text[];
begin
  -- periodo de teste: de 5 dias atras ate amanha (meia-noite de Sao Paulo)
  de := ((hoje - 5)::timestamp at time zone 'America/Sao_Paulo');
  ate := ((hoje + 1)::timestamp at time zone 'America/Sao_Paulo');

  -- contrato A (assinado hoje): entrada 1000 paga hoje; parcela 1: 500 vencida ha 10 dias; parcela 2: 500 vence em 20 dias  -> total 2000
  c1 := painel.contrato_registrar('+5511999988001', 'Contrato A', 'A-1', 2000, hoje, jsonb_build_array(
    jsonb_build_object('numero', 0, 'valor', 1000, 'vencimento', hoje, 'pago_em', hoje),
    jsonb_build_object('numero', 1, 'valor', 500, 'vencimento', hoje - 10),
    jsonb_build_object('numero', 2, 'valor', 500, 'vencimento', hoje + 20)));
  -- contrato B (assinado ha 30 dias, fora do periodo): parcela unica de 300 paga ha 2 dias (dentro do periodo) e uma de 200 vencendo hoje
  c2 := painel.contrato_registrar('+5511999988002', 'Contrato B', null, 500, hoje - 30, jsonb_build_array(
    jsonb_build_object('numero', 1, 'valor', 300, 'vencimento', hoje - 3, 'pago_em', hoje - 2),
    jsonb_build_object('numero', 2, 'valor', 200, 'vencimento', hoje)));

  select * into r from painel.contratos_numeros(de, ate);
  assert r.fechados >= 1, 'fechados conta o contrato A: ' || r.fechados;
  assert r.receita_contratada >= 2000, 'receita contratada inclui A (B esta fora do periodo)';
  assert r.receita_recebida >= 1300, 'recebida inclui a entrada de A (1000) e a parcela paga de B (300)';
  -- isolamento: periodo estreito so com ontem nao pega nada de A (assinado hoje)
  select * into r from painel.contratos_numeros(((hoje - 1)::timestamp at time zone 'America/Sao_Paulo'), (hoje::timestamp at time zone 'America/Sao_Paulo'));
  assert r.receita_contratada = (select coalesce(sum(valor_total), 0) from painel.contratos where assinado_em = hoje - 1), 'fronteira: [de, ate) nao inclui hoje';
  select * into r from painel.contratos_numeros(de, ate);
  assert r.atrasado >= 500, 'atrasado inclui a parcela vencida de A';
  assert r.a_receber >= 700, 'a receber: 500 de A em 20 dias + 200 de B que vence hoje (nao esta atrasada)';

  -- parcelas_abertas
  assert (select status from painel.parcelas_abertas(200) where contrato_id = c1 and numero = 1) = 'atrasada', 'atrasada';
  assert (select dias_atraso from painel.parcelas_abertas(200) where contrato_id = c1 and numero = 1) = 10, '10 dias de atraso';
  assert (select status from painel.parcelas_abertas(200) where contrato_id = c1 and numero = 2) = 'a_receber', 'a receber';
  assert (select status from painel.parcelas_abertas(200) where contrato_id = c2 and numero = 2) = 'a_receber', 'vence hoje: a receber';
  assert (select status from painel.parcelas_abertas(200) where contrato_id = c2 and numero = 1) = 'paga', 'paga recentemente aparece (para desfazer)';
  assert (select pago_em from painel.parcelas_abertas(200) where contrato_id = c1 and numero = 0) = hoje, 'entrada paga hoje aparece';
  assert (select count(*) from painel.parcelas_abertas(2)) = 2, 'respeita o limite';
  select array_agg(proargnames[i]) into colunas from pg_proc, generate_subscripts(proargnames, 1) i where oid = 'painel.parcelas_abertas(integer)'::regprocedure;
  assert not (colunas && array['texto', 'mensagem', 'conteudo']), 'sem colunas de conversa';

  -- fila: parcela atrasada aparece uma vez por lead, com valor e dias; some quando paga
  select * into r from painel.fila_atencao() where telefone = '+5511999988001';
  assert r.tipo = 'parcela_atrasada' and r.urgencia = 5, 'parcela atrasada na fila: ' || coalesce(r.tipo, 'nao apareceu');
  assert r.detalhe = 'R$ 500,00 em atraso há 10 dias', 'detalhe: ' || r.detalhe;
  assert r.lead_nome = 'Contrato A' and r.telefone_fim = '8001', 'nome e final do telefone';
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999988002'), 'B nao tem parcela atrasada (uma paga, uma vence hoje)';
  select id into pid from painel.parcelas where contrato_id = c1 and numero = 1;
  perform painel.parcela_marcar_paga(pid, hoje, 'teste');
  assert not exists (select 1 from painel.fila_atencao() where telefone = '+5511999988001'), 'some da fila quando marcada como paga';
  perform painel.parcela_desfazer(pid, 'teste');
  assert exists (select 1 from painel.fila_atencao() where telefone = '+5511999988001' and tipo = 'parcela_atrasada'), 'volta ao desfazer';

  -- varias parcelas atrasadas do mesmo lead viram um item
  perform painel.contrato_registrar('+5511999988003', 'Contrato C', null, 600, hoje, jsonb_build_array(
    jsonb_build_object('numero', 1, 'valor', 300, 'vencimento', hoje - 40), jsonb_build_object('numero', 2, 'valor', 300, 'vencimento', hoje - 5)));
  assert (select count(*) from painel.fila_atencao() where telefone = '+5511999988003') = 1, 'um item por lead';
  assert (select detalhe from painel.fila_atencao() where telefone = '+5511999988003') = '2 parcelas somando R$ 600,00, a mais antiga há 40 dias', 'detalhe agregado';

  -- ordenacao: urgencia 5 vem depois da 4 e antes da 6/7
  assert (select array_agg(urgencia order by ord) = array_agg(urgencia order by urgencia, desde) from (select urgencia, desde, row_number() over () as ord from painel.fila_atencao()) x), 'ordenada por urgencia';
  assert not has_function_privilege('anon', 'painel.contratos_numeros(timestamptz, timestamptz)', 'execute'), 'anon sem execute';
  assert has_function_privilege('painel_leitura', 'painel.parcelas_abertas(integer)', 'execute'), 'painel_leitura le';
end $t$;
rollback;
select 'OK 0078' as resultado;
