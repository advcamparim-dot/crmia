-- supabase/tests/0032_busca_leads_por_nome.test.sql
begin;
do $t$
declare r jsonb;
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'crm_sync' and table_name = 'leads' and column_name = 'phone'), 'coluna phone existe';

  insert into crm_sync.leads (id, name, status, phone, created_at, modified_at) values
    ('t-b1', 'Gilberto Fuke Teste', 'New', '+5511999990901', now(), now()),
    ('t-b2', 'Gilberto Souza Teste', 'New', '+5511999990902', now(), now()),
    ('t-b3', 'Solange de Brito Teste', 'New', '+5518999990903', now(), now()),
    ('t-b4', 'Sem Telefone Teste', 'New', null, now(), now());
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values ('+5511999990901', 'Gilberto Fuke Teste', 'ativo', 't-b1');

  -- um resultado so (o mesmo lead no CRM e na lista conta uma vez)
  r := mayara.buscar_leads_por_nome('fuke teste');
  assert jsonb_array_length(r) = 1, 'um resultado para fuke: ' || r::text;
  assert (r -> 0 ->> 'fim') = '0901', 'final do telefone';
  assert (r -> 0 ->> 'origem') = 'lista_e_crm', 'origem informada: ' || r::text;

  -- dois resultados para o primeiro nome
  r := mayara.buscar_leads_por_nome('gilberto');
  assert jsonb_array_length(r)   >= 2, 'varios gilbertos: ' || r::text;

  -- ignora acento e caixa
  r := mayara.buscar_leads_por_nome('SOLÂNGE de brito teste');
  assert jsonb_array_length(r) = 1, 'sem acento e caixa: ' || r::text;

  -- nenhum resultado
  r := mayara.buscar_leads_por_nome('inexistentezzz');
  assert jsonb_array_length(r) = 0, 'zero resultados';

  -- lead do CRM sem telefone nao e acionavel
  r := mayara.buscar_leads_por_nome('Sem Telefone Teste');
  assert jsonb_array_length(r) = 1 and (r -> 0 ->> 'telefone') is null, 'sem telefone aparece como nao acionavel: ' || r::text;

  -- busca vazia ou curta demais nao lista todo mundo
  assert jsonb_array_length(mayara.buscar_leads_por_nome('')) = 0, 'vazio nao lista';
  assert jsonb_array_length(mayara.buscar_leads_por_nome('a')) = 0, 'uma letra nao lista';

  -- limite de resultados
  insert into crm_sync.leads (id, name, status, phone, created_at, modified_at)
    select 't-m' || g, 'Maria Teste ' || g, 'New', '+55119999908' || lpad(g::text, 2, '0'), now(), now() from generate_series(10, 25) g;
  assert jsonb_array_length(mayara.buscar_leads_por_nome('maria teste')) = 10, 'limita a 10';

  assert not has_function_privilege('anon', 'mayara.buscar_leads_por_nome(text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.buscar_leads_por_nome(text)', 'execute'), 'authenticated sem execute';
end $t$;
rollback;
select 'OK 0032' as resultado;
