-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999987xxx); termina em rollback.
begin;
do $t$
declare
  adm text := '+5511999987000'; r text; contrato jsonb; errado jsonb; parcelas jsonb; n int; cid bigint;
  ped jsonb;
begin
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  update mayara.instrucoes set estado = 'cancelada' where estado = 'pendente';
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id) values
    ('+5511999987001', 'Cliente Sintetico', 'x', 'K-1'),
    ('+5511999987002', 'Maria Sintetica Alfa', 'x', 'K-2'), ('+5511999987003', 'Maria Sintetica Beta', 'x', 'K-3');

  select jsonb_agg(p order by (p ->> 'numero')::int) into parcelas from (
    select jsonb_build_object('numero', 0, 'valor_centavos', 500000, 'vencimento', '2026-10-20', 'pago_em', '2026-10-20') p
    union all
    select jsonb_build_object('numero', k, 'valor_centavos', 160000, 'vencimento', (date '2026-11-20' + make_interval(months => k - 1))::date::text, 'pago_em', null) from generate_series(1, 12) k) q;
  contrato := jsonb_build_object('total_centavos', 2420000, 'assinado_em', painel._hoje()::text, 'parcelas', parcelas,
                                 'resumo_corpo', E'Total: R$ 24.200,00.\nEntrada: R$ 5.000,00 (paga em 20/10/2026).\n12 parcelas de R$ 1.600,00, de 20/11/2026 a 20/10/2027.');
  errado := contrato || jsonb_build_object('total_centavos', 2400000);

  -- formatacao de dinheiro
  assert mayara._brl(2420000) = 'R$ 24.200,00' and mayara._brl(5) = 'R$ 0,05' and mayara._brl(123456789) = 'R$ 1.234.567,89', 'brl';

  -- chave desligada (padrao)
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987001', 'contrato', contrato), adm);
  assert r = 'Essa ação ainda não está habilitada.', 'desligado: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'desligado nao cria pendencia';
  update mayara.config set valor = 'ligado' where chave = 'contrato_comando';

  -- soma errada: informa a diferenca, nao cria pendencia
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987001', 'contrato', errado), adm);
  assert r like '%R$ 24.200,00%' and r like '%R$ 24.000,00%' and r like '%R$ 200,00%' and r like '%Nada foi gravado%', 'soma errada: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'soma errada nao cria pendencia';

  -- contrato malformado
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987001', 'contrato', '{"parcelas":"x"}'::jsonb), adm);
  assert r like 'Não entendi com segurança%', 'malformado recusado';

  -- lead ambiguo e inexistente
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'nome', 'Maria Sintetica', 'contrato', contrato), adm);
  assert r like '%mais de um lead%' and r like '%Alfa%' and r like '%Beta%', 'ambiguo lista candidatos: ' || r;
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'nome', 'Fulano Inexistente Zzz', 'contrato', contrato), adm);
  assert r like 'Não achei nenhum lead%', 'inexistente: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'ambiguo e inexistente nao criam pendencia';

  -- pedido valido: cria pendencia com o resumo
  ped := jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987001', 'contrato', contrato);
  r := mayara.executar_livre(ped, adm);
  assert r like 'Registrar contrato de Cliente Sintetico (final 7001):%' and r like '%24.200,00%' and r like '%Confirma?%', 'resumo e confirmacao: ' || r;
  assert (select count(*) from mayara.acoes_pendentes where estado = 'pendente' and acao = 'registrar_contrato') = 1, 'uma pendencia';
  assert not exists (select 1 from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987001')), 'nada gravado antes do sim';

  -- segunda acao enquanto ha pendente
  r := mayara.executar_livre(jsonb_build_object('acao', 'pausar'), adm);
  assert r like 'Ainda há uma ação aguardando confirmação%', 'segunda acao bloqueada';

  -- "sim" grava
  r := mayara.confirmar_acao_pendente('sim');
  assert r like 'Contrato registrado%', 'sim grava: ' || r;
  select id into cid from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987001');
  assert cid is not null and (select valor_total from painel.contratos where id = cid) = 24200, 'contrato gravado';
  assert (select count(*) from painel.parcelas where contrato_id = cid) = 13, '13 parcelas';
  assert (select pago_em from painel.parcelas where contrato_id = cid and numero = 0) is not null, 'entrada paga';
  assert (select crm_lead_id from painel.contratos where id = cid) = 'K-1', 'liga ao lead do CRM';
  assert mayara.confirmar_acao_pendente('sim') is null, 'sim repetido nao faz nada';
  assert (select count(*) from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987001')) = 1, 'um so contrato';

  -- "nao" cancela
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987002', 'contrato', contrato), adm);
  r := mayara.confirmar_acao_pendente('não');
  assert r like 'Ok, cancelei: Registrar contrato de Maria Sintetica Alfa%', 'nao cancela: ' || r;
  assert not exists (select 1 from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987002')), 'cancelado nao grava';

  -- cliente fora da lista de leads
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987099', 'contrato', contrato), adm);
  assert r like '%fora da lista de leads%', 'avisa cliente fora da lista: ' || r;
  r := mayara.confirmar_acao_pendente('sim');
  assert r like 'Contrato registrado%' and exists (select 1 from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987099')), 'grava para telefone fora da lista';

  -- expira em 10 minutos
  r := mayara.executar_livre(jsonb_build_object('acao', 'registrar_contrato', 'telefone', '+5511999987003', 'contrato', contrato), adm);
  update mayara.acoes_pendentes set confirmar_ate = now() - interval '1 minute' where estado = 'pendente';
  r := mayara.confirmar_acao_pendente('sim');
  assert r like 'A ação expirou%', 'expirou: ' || r;
  assert not exists (select 1 from painel.contratos where lead_chave = mayara.chave_telefone('+5511999987003')), 'expirado nao grava';

  -- regressao: outras acoes continuam iguais
  r := mayara.executar_livre(jsonb_build_object('acao', 'assumir', 'telefone', '+5511999987001'), adm);
  assert r like 'Assumir o lead Cliente Sintetico (final 7001)%' and r like '%Confirma?%', 'assumir continua: ' || r;
  r := mayara.confirmar_acao_pendente('não');
  assert r like 'Ok, cancelei: Assumir o lead%', 'cancelar assumir continua';
  r := mayara.executar_livre(jsonb_build_object('acao', 'pausar'), adm);
  assert r like 'Pausar a Mayara%' and r like '%Confirma?%', 'pausar continua';
  r := mayara.confirmar_acao_pendente('sim');
  assert r like '@efeito%paused%', 'sim em pausar continua devolvendo o efeito';
end $t$;
rollback;
select 'OK 0077' as resultado;
