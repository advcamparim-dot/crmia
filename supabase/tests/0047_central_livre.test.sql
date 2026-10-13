-- supabase/tests/0047_central_livre.test.sql
begin;
do $t$
declare r text; v jsonb;
begin
  insert into mayara.leads_autorizados (telefone, nome, status) values
    ('+5511999990471', 'Zelia Livre Teste', 'ativo'),
    ('+5511999990472', 'Marcos Livre Teste', 'ativo'),
    ('+5511999990473', 'Marcos Livre Outro', 'ativo');
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  update mayara.instrucoes set estado = 'recusada', encerrada_em = now() where estado = 'pendente';

  -- consultas
  r := mayara.executar_livre('{"acao":"contagem_leads","periodo":"semana"}'::jsonb, 'x');
  assert r like '%leads recebidos nos últimos 7 dias%', 'contagem: ' || r;
  r := mayara.executar_livre('{"acao":"situacao_lead","nome":"Zelia Livre"}'::jsonb, 'x');
  assert r like 'Zelia Livre Teste (final 0471)%', 'situacao por nome: ' || r;
  r := mayara.executar_livre('{"acao":"situacao_lead","telefone":"+5511999990471"}'::jsonb, 'x');
  assert r like 'Zelia Livre Teste (final 0471)%', 'situacao por telefone: ' || r;
  assert mayara.executar_livre('{"acao":"listar_regras"}'::jsonb, 'x') = mayara.regras_texto(), 'listar_regras';
  assert mayara.executar_livre('{"acao":"status"}'::jsonb, 'x') = mayara.status_resumo(), 'status';

  -- nome: zero ou varios candidatos nunca gravam pendencia
  r := mayara.executar_livre('{"acao":"assumir","nome":"Inexistentezzz"}'::jsonb, 'x');
  assert r like 'Não achei nenhum lead com o nome%Envie o telefone%', 'zero: ' || r;
  r := mayara.executar_livre('{"acao":"assumir","nome":"Marcos Livre"}'::jsonb, 'x');
  assert r like '%Marcos Livre Teste (final 0472)%' and r like '%Marcos Livre Outro (final 0473)%' and r like '%Repita o pedido com o telefone%', 'varios: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'zero/varios nao gravam pendencia';

  -- acao de efeito so grava pendencia
  r := mayara.executar_livre('{"acao":"assumir","nome":"Zelia Livre"}'::jsonb, 'x');
  assert r like 'Assumir o lead Zelia Livre Teste (final 0471)%Confirma? Responda *sim* ou *não*%', 'assumir: ' || r;
  assert (select acao from mayara.acoes_pendentes where estado = 'pendente') = 'assumir', 'pendencia assumir';
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990471') = 'ativo', 'assumir nao executa antes do sim';
  r := mayara.executar_livre('{"acao":"pausar"}'::jsonb, 'x');
  assert r like 'Ainda há uma ação aguardando confirmação:%', 'segunda proposta bloqueada: ' || r;
  r := mayara.executar_central('confirmar_sim', '', '', 'x');
  assert (select status from mayara.leads_autorizados where telefone = '+5511999990471') <> 'ativo', 'sim executa o assumir: ' || r;
  assert mayara.executar_central('confirmar_sim', '', '', 'x') like 'Não há nenhuma instrução aguardando%', 'segundo sim nao executa de novo';

  -- pausar e ligar devolvem o marcador @efeito no sim
  r := mayara.executar_livre('{"acao":"pausar"}'::jsonb, 'x');
  assert r like 'Pausar a Mayara%Confirma?%', 'pausar: ' || r;
  r := mayara.executar_central('confirmar_sim', '', '', 'x');
  assert r like '@efeito {"tipo":"modo","aiMode":"paused"}%', 'pausar sim: ' || r;
  r := mayara.executar_livre('{"acao":"ligar"}'::jsonb, 'x');
  r := mayara.executar_central('confirmar_nao', '', '', 'x');
  assert r like 'Ok, cancelei: Ligar a Mayara%', 'ligar nao: ' || r;

  -- regras
  insert into mayara.instrucoes (id, texto, estado, ativada_em, autor_chave) values (990047, 'Regra de teste da fase 3', 'ativa', now(), 'x');
  r := mayara.executar_livre('{"acao":"desfazer_regra","numero_regra":990047}'::jsonb, 'x');
  assert r like 'Desfazer a regra 990047: Regra de teste da fase 3%Confirma?%', 'desfazer: ' || r;
  r := mayara.executar_central('confirmar_nao', '', '', 'x');
  r := mayara.executar_livre('{"acao":"desfazer_regra","numero_regra":990048}'::jsonb, 'x');
  assert r like 'Não achei a regra 990048%', 'regra inexistente: ' || r;
  r := mayara.executar_livre('{"acao":"desfazer_regra"}'::jsonb, 'x');
  assert r like 'Não achei a regra%', 'regra sem numero: ' || r;

  -- abordar segue desabilitado ate a Fase 4; acao invalida nao faz nada
  r := mayara.executar_livre('{"acao":"abordar","telefone":"+5511999990472"}'::jsonb, 'x');
  assert r = 'Essa ação ainda não está habilitada.', 'abordar: ' || r;
  r := mayara.executar_livre('{"acao":"apagar_tudo"}'::jsonb, 'x');
  assert r like 'Não entendi com segurança, então nada foi feito.%', 'acao invalida: ' || r;
  r := mayara.executar_livre(null, 'x');
  assert r like 'Não entendi com segurança%', 'pedido nulo: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'nada pendente no fim';

  -- executar_central: ramo livre e ramos antigos preservados
  assert mayara.executar_central('livre', '{"acao":"listar_regras"}', '', 'x') = mayara.regras_texto(), 'executar_central livre';
  assert mayara.executar_central('livre', 'isto nao e json', '', 'x') like 'Não entendi com segurança%', 'livre com json invalido';
  assert mayara.executar_central('regras', '', '', 'x') = mayara.regras_texto(), 'ramo antigo: regras';
  assert mayara.executar_central('followup', '', '', 'x') like 'Follow-up: %', 'ramo antigo: followup';
  assert mayara.executar_central('xyz', '', '', 'x') = 'Comando não reconhecido. Envie /ajuda.', 'ramo desconhecido';

  -- contexto_central: chave livre acompanha a configuracao
  update mayara.config set valor = 'false' where chave = 'central_linguagem_livre';
  assert (mayara.contexto_central('x') ->> 'livre') = 'false', 'livre desligada';
  update mayara.config set valor = 'true' where chave = 'central_linguagem_livre';
  v := mayara.contexto_central('x');
  assert (v ->> 'livre') = 'true' and v ? 'pendente' and v ? 'acao_pendente' and v ? 'exclusivo' and v ? 'propostas_abertas', 'livre ligada e chaves antigas: ' || v::text;
end $t$;
rollback;
select 'OK 0047';
