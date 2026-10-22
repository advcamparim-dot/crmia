begin;
do $$
declare soma integer; q integer; n integer;
begin
  assert (select count(*) from painel.leads_por_etapa()) = 7, 'sete linhas';
  select coalesce(sum(quantidade), 0) into soma from painel.leads_por_etapa();
  assert soma = (select count(*) from painel._classe_leads()), 'soma das etapas = leads classificados';
  select quantidade into q from painel.leads_por_etapa() where etapa = 'Novo';
  select count(*) into n from painel.leads_da_etapa('Novo');
  assert n = least(q, 200), 'lista da etapa tem o mesmo tamanho da contagem';
  assert (select count(*) from painel.leads_da_etapa('inexistente')) = 0, 'etapa desconhecida vem vazia';
end $$;
select 'OK 0084';
rollback;
