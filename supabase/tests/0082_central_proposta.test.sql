-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999992xxx); termina em rollback.
begin;
do $t$
declare
  adm text := '+5511999992000'; r text; hoje date := painel._hoje(); k1 text := mayara.chave_telefone('+5511999992001');
begin
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  update mayara.instrucoes set estado = 'cancelada' where estado = 'pendente';
  insert into mayara.leads_autorizados (telefone, nome, origem, status) values
    ('+5511999992001', 'Cliente Proposta', 'x', 'ativo'), ('+5511999992002', 'Ana Sintetica Alfa', 'x', 'ativo'), ('+5511999992003', 'Ana Sintetica Beta', 'x', 'ativo');

  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'telefone', '+5511999992001'), adm);
  assert r = 'Essa ação ainda não está habilitada.', 'desligado: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'desligado nao cria pendencia';
  update mayara.config set valor = 'ligado' where chave = 'proposta_comando';

  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'nome', 'Ana Sintetica'), adm);
  assert r like '%mais de um lead%' and r like '%Alfa%' and r like '%Beta%', 'ambiguo: ' || r;
  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'nome', 'Fulano Inexistente Zzz'), adm);
  assert r like 'Não achei nenhum lead%', 'inexistente: ' || r;
  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'telefone', '+5511999992001', 'data', 'ontem'), adm);
  assert r like 'Não entendi com segurança%', 'data invalida recusada: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'recusas nao criam pendencia';

  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'telefone', '+5511999992001'), adm);
  assert r like 'Registrar proposta enviada para Cliente Proposta (final 2001), em %' and r like '%bloqueado para a Mayara%' and r like '%Confirma?%', 'resumo: ' || r;
  assert (select status from mayara.leads_autorizados where telefone_chave = k1) = 'ativo', 'nada muda antes do sim';
  assert not exists (select 1 from mayara.proposta_enviada where telefone_chave = k1), 'nada gravado antes do sim';
  r := mayara.executar_livre(jsonb_build_object('acao', 'pausar'), adm);
  assert r like 'Ainda há uma ação aguardando confirmação%', 'segunda acao bloqueada';
  r := mayara.confirmar_acao_pendente('sim');
  assert r like 'Proposta registrada para Cliente Proposta (final 2001)%' and r like '%4 lembretes%', 'sim registra: ' || r;
  assert (select status from mayara.leads_autorizados where telefone_chave = k1) = 'bloqueado', 'lead bloqueado';
  assert (select enviada_em from mayara.proposta_enviada where telefone_chave = k1 and estado = 'ativa') = hoje, 'data de hoje por padrao';
  assert mayara.confirmar_acao_pendente('sim') is null, 'sim repetido nao faz nada';

  -- com data informada e cancelamento
  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'telefone', '+5511999992002', 'data', (hoje - 3)::text), adm);
  assert r like '%' || to_char(hoje - 3, 'DD/MM/YYYY') || '%', 'resumo mostra a data: ' || r;
  r := mayara.confirmar_acao_pendente('não');
  assert r like 'Ok, cancelei: Registrar proposta enviada%', 'nao cancela: ' || r;
  assert not exists (select 1 from mayara.proposta_enviada where telefone_chave = mayara.chave_telefone('+5511999992002')), 'cancelado nao grava';
  r := mayara.executar_livre(jsonb_build_object('acao', 'proposta_enviada', 'telefone', '+5511999992002', 'data', (hoje - 3)::text), adm);
  r := mayara.confirmar_acao_pendente('sim');
  assert (select enviada_em from mayara.proposta_enviada where telefone_chave = mayara.chave_telefone('+5511999992002') and estado = 'ativa') = hoje - 3, 'registra com a data informada';

  -- regressao das outras acoes
  r := mayara.executar_livre(jsonb_build_object('acao', 'assumir', 'telefone', '+5511999992003'), adm);
  assert r like 'Assumir o lead Ana Sintetica Beta (final 2003)%' and r like '%Confirma?%', 'assumir continua: ' || r;
  r := mayara.confirmar_acao_pendente('não');
  r := mayara.executar_livre(jsonb_build_object('acao', 'pausar'), adm);
  assert r like 'Pausar a Mayara%', 'pausar continua';
  r := mayara.confirmar_acao_pendente('não');
  r := mayara.criar_acao_pendente('apagar_tudo', '{}'::jsonb, 'x', adm);
  assert r like '%não reconhecida%', 'acao fora da lista';
end $t$;
rollback;
select 'OK 0082' as resultado;
