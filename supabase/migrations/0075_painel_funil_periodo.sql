-- Funil por coorte sobre painel.eventos. Posto das etapas: Novo 1, Em conversa 2, Consulta 3, Com a equipe 3, Contrato 4.
-- entraram = evento da etapa dentro de [de, ate); avancaram = entraram e tem evento de posto maior; perderam = entraram,
-- tem 'perdido' e nenhum evento de posto maior; agora = quantos estao na etapa neste momento.
create or replace function painel.funil_periodo(p_de timestamptz, p_ate timestamptz)
returns table(etapa text, ordem integer, entraram integer, avancaram integer, perderam integer, agora integer)
language sql stable set search_path = '' as $$
  with ev as (select e.lead_chave, e.tipo, min(e.ocorrido_em) as t from painel.eventos e group by 1, 2),
       lead as (
         select ev.lead_chave,
                min(t) filter (where tipo = 'lead_criado') as t_novo,
                min(t) filter (where tipo = 'lead_respondeu') as t_conversa,
                min(t) filter (where tipo = 'consulta_marcada') as t_consulta,
                min(t) filter (where tipo = 'transferido_equipe') as t_equipe,
                min(t) filter (where tipo = 'contrato_fechado') as t_contrato,
                min(t) filter (where tipo = 'perdido') as t_perdido
           from ev group by 1),
       etapas(ordem, etapa, posto) as (values (1, 'Novo', 1), (2, 'Em conversa', 2), (3, 'Consulta', 3), (4, 'Com a equipe', 3), (5, 'Contrato', 4)),
       entradas as (
         select e.ordem, e.etapa, e.posto, l.*,
                case e.ordem when 1 then l.t_novo when 2 then l.t_conversa when 3 then l.t_consulta when 4 then l.t_equipe else l.t_contrato end as te
           from etapas e cross join lead l),
       dentro as (
         select d.*,
                ((d.posto < 2 and (d.t_conversa is not null or d.t_consulta is not null or d.t_equipe is not null or d.t_contrato is not null))
                 or (d.posto < 3 and (d.t_consulta is not null or d.t_equipe is not null or d.t_contrato is not null))
                 or (d.posto < 4 and d.t_contrato is not null)) as avancou
           from entradas d where d.te >= p_de and d.te < p_ate),
       atual as (select x.etapa, x.quantidade from painel.leads_por_etapa() x)
  select e.etapa, e.ordem,
         count(d.lead_chave)::integer,
         count(d.lead_chave) filter (where d.avancou)::integer,
         count(d.lead_chave) filter (where not d.avancou and d.t_perdido is not null)::integer,
         coalesce((select a.quantidade from atual a where a.etapa = e.etapa), 0)::integer
    from etapas e left join dentro d on d.ordem = e.ordem
   group by e.etapa, e.ordem
   order by e.ordem
$$;

revoke all on function painel.funil_periodo(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function painel.funil_periodo(timestamptz, timestamptz) to painel_leitura;
