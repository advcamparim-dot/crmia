-- supabase/tests/0055_livre_lead_so_crm.test.sql
begin;
do $t$
declare r text;
begin
  update mayara.acoes_pendentes set estado = 'cancelada', encerrada_em = now() where estado = 'pendente';
  insert into crm_sync.leads (id, name, status, created_at, modified_at, phone)
    values ('crm-teste-0055', 'Carlota Somente Crm Teste', 'New', now(), now(), '+5511999990551');
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990552', 'Lista Mayara Teste', 'ativo');

  -- assumir e devolver um lead que so existe no CRM nao grava pendencia
  r := mayara.executar_livre('{"acao":"assumir","nome":"Carlota Somente"}'::jsonb, 'x');
  assert r like '%Carlota Somente Crm Teste%está no CRM%não está na lista de atendimento da Mayara%', 'assumir CRM: ' || r;
  r := mayara.executar_livre('{"acao":"devolver","nome":"Carlota Somente"}'::jsonb, 'x');
  assert r like '%está no CRM%não está na lista de atendimento da Mayara%', 'devolver CRM: ' || r;
  r := mayara.executar_livre('{"acao":"assumir","telefone":"+5511999990551"}'::jsonb, 'x');
  assert r like '%não está na lista de atendimento da Mayara%', 'assumir por telefone fora da lista: ' || r;
  assert not exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'), 'nenhuma pendencia criada';

  -- consulta e abordagem continuam permitidas para lead so do CRM
  r := mayara.executar_livre('{"acao":"situacao_lead","telefone":"+5511999990551"}'::jsonb, 'x');
  assert r like '%não está na lista de leads da Mayara%', 'situacao CRM: ' || r;
  r := mayara.executar_livre('{"acao":"abordar","nome":"Carlota Somente"}'::jsonb, 'x');
  assert r = 'Essa ação ainda não está habilitada.', 'abordar CRM segue como antes: ' || r;

  -- lead da lista continua gerando pendencia
  r := mayara.executar_livre('{"acao":"assumir","nome":"Lista Mayara"}'::jsonb, 'x');
  assert r like 'Assumir o lead Lista Mayara Teste (final 0552)%Confirma?%', 'assumir lead da lista: ' || r;
  assert (select acao from mayara.acoes_pendentes where estado = 'pendente') = 'assumir', 'pendencia criada';
end $t$;
rollback;
select 'OK 0055';
