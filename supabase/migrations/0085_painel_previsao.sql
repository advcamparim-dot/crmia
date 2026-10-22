-- Previsao de vendas: chance de fechar e prazo por etapa + valor medio de contrato, definidos pelo dono.
create table if not exists painel.previsao_taxas (
  etapa text primary key check (etapa in ('Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada')),
  chance numeric(5,4) not null check (chance >= 0 and chance <= 1),
  prazo_dias integer not null check (prazo_dias in (20, 40, 60)),
  atualizado_em timestamptz not null default now()
);
create table if not exists painel.previsao_config (
  id boolean primary key default true check (id),
  ticket_medio numeric(14,2) not null check (ticket_medio > 0),
  atualizado_em timestamptz not null default now()
);
alter table painel.previsao_taxas enable row level security;
alter table painel.previsao_config enable row level security;
revoke all on painel.previsao_taxas, painel.previsao_config from public, anon, authenticated;

insert into painel.previsao_taxas (etapa, chance, prazo_dias) values
  ('Novo', 0.02, 60), ('Em conversa', 0.08, 40), ('Consulta', 0.25, 40), ('Com a equipe', 0.15, 40), ('Proposta enviada', 0.30, 20)
on conflict (etapa) do nothing;
insert into painel.previsao_config (id, ticket_medio) values (true, 8000) on conflict (id) do nothing;

create or replace function painel.previsao_definir(p_etapa text, p_chance numeric, p_prazo integer)
returns void language plpgsql set search_path = '' as $$
begin
  if p_chance is null or p_chance < 0 or p_chance > 1 then raise exception 'chance invalida'; end if;
  update painel.previsao_taxas set chance = round(p_chance, 4), prazo_dias = p_prazo, atualizado_em = now() where etapa = p_etapa;
  if not found then raise exception 'etapa invalida'; end if;
end $$;

create or replace function painel.previsao_ticket_definir(p_valor numeric)
returns void language plpgsql set search_path = '' as $$
begin
  if p_valor is null or p_valor <= 0 or p_valor > 10000000 then raise exception 'valor medio invalido'; end if;
  update painel.previsao_config set ticket_medio = round(p_valor, 2), atualizado_em = now() where id;
end $$;

-- Uma linha por etapa ativa, mais o valor medio usado (real a partir de 3 contratos, antes disso o do dono).
create or replace function painel.previsao()
returns table(etapa text, leads integer, chance numeric, prazo_dias integer, esperados numeric, ticket_medio numeric, ticket_origem text)
language sql stable set search_path = '' as $$
  with t as (
    select case when (select count(*) from painel.contratos) >= 3
                then (select round(avg(valor_total), 2) from painel.contratos)
                else (select c.ticket_medio from painel.previsao_config c where c.id) end as valor,
           case when (select count(*) from painel.contratos) >= 3 then 'real' else 'definido' end as origem)
  select x.etapa, x.quantidade, k.chance, k.prazo_dias, round(x.quantidade * k.chance, 2), t.valor, t.origem
    from painel.leads_por_etapa() x
    join painel.previsao_taxas k on k.etapa = x.etapa
    cross join t
   order by array_position(array['Novo', 'Em conversa', 'Consulta', 'Com a equipe', 'Proposta enviada'], x.etapa)
$$;

revoke all on function painel.previsao_definir(text, numeric, integer), painel.previsao_ticket_definir(numeric), painel.previsao() from public, anon, authenticated;
grant execute on function painel.previsao_definir(text, numeric, integer), painel.previsao_ticket_definir(numeric), painel.previsao() to painel_leitura;
