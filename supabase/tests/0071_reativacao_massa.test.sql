-- Rodar inteiro (execute_sql). Dados sinteticos (+5511999981xxx, CRM com created_at no futuro para ficar na frente da fila); termina em rollback.
begin;
do $t$
declare
  seg timestamptz := '2026-12-08 10:00:00-03'; -- terca, dentro do expediente
  b timestamptz := now(); -- criar_proposta grava a hora real; os testes de intervalo usam a hora real
  n int; id1 bigint; id2 bigint; r jsonb; txt text;
begin
  -- nomes
  assert mayara.reativacao_primeiro_nome('Carla Ramos') = 'Carla', 'primeiro nome';
  assert mayara.reativacao_primeiro_nome('jonison Silva Ferreira') = 'Jonison', 'caixa baixa vira Capitalizado';
  assert mayara.reativacao_primeiro_nome('Paulão Santos') = 'Paulão', 'acento';
  assert mayara.reativacao_primeiro_nome('Wellington') = 'Wellington', 'nome unico';
  assert mayara.reativacao_primeiro_nome('Darpex Darpex') is null, 'nome repetido nao e pessoa';
  assert mayara.reativacao_primeiro_nome('Araújo Neto | Obras & Negócios') is null, 'empresa com | e &';
  assert mayara.reativacao_primeiro_nome('PopDi Materiais para construção') is null, 'empresa por palavra';
  assert mayara.reativacao_primeiro_nome('Zé rei do agro') is null, 'nome curto ou empresa';
  assert mayara.reativacao_primeiro_nome(null) is null and mayara.reativacao_primeiro_nome('   ') is null, 'vazio';

  txt := mayara.reativacao_texto_para('Carla Ramos');
  assert txt like 'Olá, Carla. Tudo bem? Aqui é a Mayara, do Camparim Advogados.%' and txt like '%Você ainda precisa de ajuda com isso?', 'texto com nome: ' || txt;
  assert (select count(*) from regexp_matches(txt, '\?', 'g')) = 2, 'duas interrogacoes no texto (saudacao e pergunta final)';
  assert char_length(txt) <= 600 and txt !~* 'http', 'tamanho e sem link';
  assert mayara.reativacao_texto_para('Darpex Darpex') like 'Olá. Tudo bem?%', 'sem nome: saudacao sem virgula';

  -- cadastro
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone) values
    ('T-1', 'Teste Um', 'New', '2099-01-03', now(), '+5511999981001'),
    ('T-2', 'Teste Dois', 'New', '2099-01-02', now(), '+5511999981002'),
    ('T-3', 'Teste Tres', 'New', '2099-01-01', now(), '+5511999981003'),
    ('T-4', 'Sem Telefone', 'New', '2099-01-04', now(), null),
    ('T-5', 'Ja Na Lista', 'New', '2099-01-05', now(), '+5511999981005');
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id) values ('+5511999981005', 'Ja Na Lista', 'landing_campanha_pj', 'T-5');
  n := mayara.reativacao_cadastrar();
  assert n >= 3, 'cadastrou os sinteticos (e os reais fora da lista): ' || n;
  assert (select count(*) from mayara.leads_autorizados where espocrm_lead_id in ('T-1', 'T-2', 'T-3') and origem = 'reativacao_massa' and status = 'ativo' and abordagem_ate is null) = 3, 'ativos, origem certa, sem janela';
  assert not exists (select 1 from mayara.leads_autorizados where espocrm_lead_id = 'T-4'), 'sem telefone nao entra';
  assert (select origem from mayara.leads_autorizados where espocrm_lead_id = 'T-5') = 'landing_campanha_pj', 'quem ja estava na lista fica como estava';
  assert mayara.reativacao_cadastrar() = 0, 'idempotente';
  assert not exists (select 1 from mayara.followup_estado fe join mayara.leads_autorizados la on la.telefone_chave = fe.chave where la.espocrm_lead_id in ('T-1', 'T-2', 'T-3')), 'cadastrar nao coloca ninguem na regua';

  -- fila de envio
  update mayara.propostas_abordagem set estado = 'descartada' where estado = 'aberta';
  assert mayara.reativacao_proxima(b) is null, 'desligada por padrao';
  update mayara.config set valor = 'true' where chave = 'reativacao_ligada';
  update mayara.config set valor = '2' where chave = 'reativacao_limite_dia';
  id1 := mayara.reativacao_proxima(b);
  assert id1 is not null, 'cria a primeira proposta';
  assert (select lacuna from mayara.propostas_abordagem where id = id1) = 'reativacao_massa', 'proposta marcada como reativacao';
  assert (select crm_lead_id from mayara.propostas_abordagem where id = id1) = 'T-1', 'mais recente primeiro (T-1, de 03/01/2099)';
  assert mayara.reativacao_proxima(b + interval '5 minutes') is null, 'respeita o intervalo de 25 min';
  id2 := mayara.reativacao_proxima(b + interval '30 minutes');
  assert id2 is not null and (select crm_lead_id from mayara.propostas_abordagem where id = id2) = 'T-2', 'segunda depois do intervalo';
  assert mayara.reativacao_proxima(b + interval '90 minutes') is null, 'limite diario de 2 atingido';
  assert mayara.reativacao_proxima(b + interval '1 day') is not null, 'no dia seguinte volta a liberar (T-3)';

  -- integracao com o robo
  update mayara.propostas_abordagem set estado = 'descartada' where estado = 'aberta';
  update mayara.config set valor = '20' where chave = 'reativacao_limite_dia';
  update mayara.config set valor = 'true' where chave in ('abordagem_automatica', 'abordagem_assistida');
  update mayara.canal_estado set estado = 'open' where canal_id = 'escritorio';
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id) values ('+5511999981009', 'Lead Novo Quente', 'landing_campanha_pj', 'T-9');
  perform mayara.criar_proposta('+5511999981009', 'Lead Novo Quente', 'T-9', 'Oi, Quente. Recebi sua solicitacao. Qual banco?', '{}'::jsonb, 'banco');
  r := mayara.abordagem_auto_proximo(seg + interval '2 days');
  assert (r ->> 'enviar')::boolean and r ->> 'nome' = 'Lead Novo Quente', 'lead novo passa na frente da reativacao: ' || r::text;
  r := mayara.abordagem_auto_proximo(seg + interval '2 days' + interval '1 minute');
  assert (r ->> 'enviar')::boolean and r ->> 'texto' like 'Olá, %Aqui é a Mayara%', 'sem lead novo, o robo envia a reativacao: ' || r::text;
  assert (select estado from mayara.propostas_abordagem where id = (r ->> 'proposta_id')::bigint) = 'aprovada', 'proposta aprovada pelo robo';
  r := mayara.abordagem_auto_proximo('2026-12-06 10:00:00-03'); -- domingo
  assert r ->> 'motivo' = 'fora_do_expediente', 'domingo nao envia';

  -- a reativacao nao consome o teto por hora do lead novo
  update mayara.config set valor = '1' where chave = 'abordagem_auto_teto_hora';
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    select 'escritorio', p.telefone_chave, 'texto', true, 'TESTE-R', 'abordagem_automatica', seg + interval '2 days' from mayara.propostas_abordagem p where p.lacuna = 'reativacao_massa' and p.estado = 'aprovada' limit 1;
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id) values ('+5511999981010', 'Outro Quente', 'landing_campanha_pj', 'T-10');
  perform mayara.criar_proposta('+5511999981010', 'Outro Quente', 'T-10', 'Oi, Outro. Qual banco?', '{}'::jsonb, 'banco');
  r := mayara.abordagem_auto_proximo(seg + interval '2 days' + interval '10 minutes');
  assert (r ->> 'enviar')::boolean and r ->> 'nome' = 'Outro Quente', 'envio de reativacao nao bloqueia o teto por hora do lead novo: ' || r::text;

  -- inicio do ciclo da regua
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, provedor_message_id, origem, criado_em)
    values ('escritorio', mayara.chave_telefone('+5511999981003'), 'texto', true, 'TESTE-C', 'abordagem_automatica', seg);
  assert mayara._ultima_saida(mayara.chave_telefone('+5511999981003')) = seg, 'envio da abordagem automatica inicia o ciclo da regua';
end $t$;
rollback;
select 'OK 0071' as resultado;
