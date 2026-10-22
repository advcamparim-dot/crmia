-- Lista dos leads de uma etapa do funil (o painel abre a lista ao clicar na etapa).
-- A classificacao sai de leads_por_etapa para uma funcao unica, usada pelas duas.
create or replace function painel._classe_leads()
returns table(chave text, etapa text)
language sql stable set search_path = '' as $$
  with lista as (select la.telefone_chave as chave, la.status from mayara.leads_autorizados la),
       sess as (
         select mayara.chave_telefone(s.phone) as chave,
                bool_or(s.consulta_agendada_em is not null) as consulta,
                bool_or(s.estado = 'S7_HANDOFF_HUMANO') as handoff
           from mayara.session_state s group by 1),
       respondeu as (select distinct chave from painel._entradas())
  select l.chave,
         case
           when l.status = 'sem_interesse' then 'Perdidos'
           when exists (select 1 from painel.contratos c where c.lead_chave = l.chave) then 'Contrato'
           when exists (select 1 from mayara.proposta_enviada p where p.telefone_chave = l.chave and p.estado in ('ativa', 'respondeu')) then 'Proposta enviada'
           when coalesce(s.consulta, false) then 'Consulta'
           when l.status = 'bloqueado' or coalesce(s.handoff, false) then 'Com a equipe'
           when r.chave is not null then 'Em conversa'
           else 'Novo'
         end
    from lista l
    left join sess s on s.chave = l.chave
    left join respondeu r on r.chave = l.chave
$$;

create or replace function painel.leads_por_etapa()
returns table(etapa text, quantidade integer)
language sql stable set search_path = '' as $$
  with classe as (select * from painel._classe_leads())
  select e.etapa, coalesce((select count(*) from classe c where c.etapa = e.etapa), 0)::integer
    from (values (1, 'Novo'), (2, 'Em conversa'), (3, 'Consulta'), (4, 'Com a equipe'), (5, 'Proposta enviada'), (6, 'Contrato'), (7, 'Perdidos')) e(ordem, etapa)
   order by e.ordem
$$;

create or replace function painel.leads_da_etapa(p_etapa text)
returns table(lead_nome text, telefone_fim text, telefone text, crm_lead_id text)
language sql stable set search_path = '' as $$
  select la.nome, right(regexp_replace(coalesce(la.telefone, ''), '\D', '', 'g'), 4), la.telefone, la.espocrm_lead_id
    from painel._classe_leads() c
    join mayara.leads_autorizados la on la.telefone_chave = c.chave
   where c.etapa = p_etapa
   order by la.nome nulls last, la.telefone_chave
   limit 200
$$;

revoke all on function painel._classe_leads() from public, anon, authenticated;
revoke all on function painel.leads_por_etapa() from public, anon, authenticated;
revoke all on function painel.leads_da_etapa(text) from public, anon, authenticated;
grant execute on function painel.leads_por_etapa() to painel_leitura;
grant execute on function painel.leads_da_etapa(text) to painel_leitura;
