-- Metas do mes (consultas marcadas, contratos fechados e receita contratada), com auditoria.
create table if not exists painel.metas (
  mes date not null,
  tipo text not null check (tipo in ('consultas', 'contratos', 'receita')),
  valor numeric(14,2) not null check (valor >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (mes, tipo)
);
create table if not exists painel.metas_log (
  id bigserial primary key,
  mes date not null,
  tipo text not null,
  de_valor numeric(14,2),
  para_valor numeric(14,2) not null,
  quem text not null,
  quando timestamptz not null default now()
);
alter table painel.metas enable row level security;
alter table painel.metas_log enable row level security;
revoke all on painel.metas, painel.metas_log from public, anon, authenticated;

-- valor 0 = sem meta a partir deste mes (a meta mais recente de um mes anterior deixa de valer).
create or replace function painel.meta_definir(p_tipo text, p_valor numeric, p_quem text)
returns void language plpgsql set search_path = '' as $$
declare
  v_mes date := date_trunc('month', painel._hoje())::date;
  v_antes numeric;
  v_max numeric := case when p_tipo = 'receita' then 100000000 else 10000 end;
begin
  if p_tipo is null or p_tipo not in ('consultas', 'contratos', 'receita') then raise exception 'tipo de meta invalido'; end if;
  if p_valor is null or p_valor < 0 or p_valor > v_max then raise exception 'valor de meta invalido'; end if;
  if p_tipo <> 'receita' and p_valor <> trunc(p_valor) then raise exception 'a meta de % precisa ser um numero inteiro', p_tipo; end if;
  select valor into v_antes from painel.metas where mes = v_mes and tipo = p_tipo for update;
  if v_antes is not distinct from round(p_valor, 2) then return; end if;
  insert into painel.metas (mes, tipo, valor) values (v_mes, p_tipo, round(p_valor, 2))
  on conflict (mes, tipo) do update set valor = excluded.valor, atualizado_em = now();
  insert into painel.metas_log (mes, tipo, de_valor, para_valor, quem) values (v_mes, p_tipo, v_antes, round(p_valor, 2), coalesce(nullif(p_quem, ''), 'painel'));
end $$;

create or replace function painel.metas_mes()
returns table(tipo text, meta numeric, atual numeric, percentual numeric, projecao numeric, dias_restantes integer, dias_no_mes integer)
language sql stable set search_path = '' as $$
  with hoje as (select painel._hoje() as d),
       mes as (select date_trunc('month', d)::date as ini, (date_trunc('month', d) + interval '1 month')::date as fim, d from hoje),
       vigentes as (
         select distinct on (m.tipo) m.tipo, m.valor from painel.metas m, mes
          where m.mes <= mes.ini order by m.tipo, m.mes desc),
       real as (
         select 'consultas'::text as tipo, (select count(*) from painel.eventos e, mes
                  where e.tipo = 'consulta_marcada' and (e.ocorrido_em at time zone 'America/Sao_Paulo')::date >= mes.ini
                    and (e.ocorrido_em at time zone 'America/Sao_Paulo')::date < mes.fim)::numeric as atual
         union all
         select 'contratos', (select count(*) from painel.contratos c, mes where c.assinado_em >= mes.ini and c.assinado_em < mes.fim)::numeric
         union all
         select 'receita', coalesce((select sum(c.valor_total) from painel.contratos c, mes where c.assinado_em >= mes.ini and c.assinado_em < mes.fim), 0))
  select v.tipo, v.valor, r.atual,
         round(r.atual / v.valor * 100, 1),
         round(r.atual / greatest(extract(day from mes.d), 1) * (mes.fim - mes.ini), 2),
         (mes.fim - 1 - mes.d)::integer,
         (mes.fim - mes.ini)::integer
    from vigentes v join real r on r.tipo = v.tipo cross join mes
   where v.valor > 0
   order by case v.tipo when 'consultas' then 1 when 'contratos' then 2 else 3 end
$$;

revoke all on function painel.meta_definir(text, numeric, text), painel.metas_mes() from public, anon, authenticated;
grant execute on function painel.meta_definir(text, numeric, text), painel.metas_mes() to painel_leitura;
