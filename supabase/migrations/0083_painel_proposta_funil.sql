-- Etapa "Proposta enviada" no funil do painel (entre Consulta/Com a equipe e Contrato) e a etapa Contrato com dado real.
alter table painel.eventos drop constraint eventos_tipo_check;
alter table painel.eventos add constraint eventos_tipo_check check (tipo in ('lead_criado', 'primeira_mensagem', 'lead_respondeu', 'followup_enviado',
  'consulta_marcada', 'transferido_equipe', 'perdido', 'contrato_fechado', 'proposta_enviada'));

create or replace function painel.eventos_atualizar()
returns integer language plpgsql set search_path = '' as $$
declare v_total integer := 0; v_n integer;
begin
  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select mayara.chave_telefone(l.phone), 'lead_criado', min(l.created_at)
    from crm_sync.leads l where mayara.chave_telefone(l.phone) is not null
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select e.destino_chave, 'primeira_mensagem', min(e.criado_em)
    from mayara.envios_log e
   where e.ok and e.origem in ('ponte', 'abordagem_assistida', 'abordagem_automatica', 'reativacao')
     and exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = e.destino_chave)
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em)
  select x.chave, 'lead_respondeu', min(x.quando) from painel._entradas() x group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em, ref, detalhe)
  select f.chave, 'followup_enviado', f.criado_em, 'f' || f.id, jsonb_build_object('etapa', f.etapa, 'sequencia', f.sequencia)
    from mayara.followups_log f where f.estado = 'enviado'
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select mayara.chave_telefone(s.phone), 'consulta_marcada', min(least(s.updated_at, now())),
         jsonb_build_object('aprox', true, 'horario', max(s.consulta_agendada_em))
    from mayara.session_state s
   where s.consulta_agendada_em is not null and mayara.chave_telefone(s.phone) is not null
   group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select c.chave, 'transferido_equipe', min(c.quando), jsonb_build_object('aprox', true)
    from (
      select mayara.chave_telefone(s.phone) as chave, s.updated_at as quando
        from mayara.session_state s where s.estado = 'S7_HANDOFF_HUMANO'
      union all
      select la.telefone_chave, la.atualizado_em from mayara.leads_autorizados la where la.status = 'bloqueado'
    ) c where c.chave is not null group by 1
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em, detalhe)
  select la.telefone_chave, 'perdido', la.atualizado_em, jsonb_build_object('aprox', true)
    from mayara.leads_autorizados la where la.status = 'sem_interesse'
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  insert into painel.eventos (lead_chave, tipo, ocorrido_em, ref, detalhe)
  select c.lead_chave, 'contrato_fechado', ((c.assinado_em::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'),
         'c' || c.id, jsonb_build_object('valor', c.valor_total)
    from painel.contratos c
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- proposta enviada (data informada pelo administrador, meio-dia de Sao Paulo); uma por proposta registrada
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, ref)
  select p.telefone_chave, 'proposta_enviada', ((p.enviada_em::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'), 'p' || p.id
    from mayara.proposta_enviada p
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end $$;

create or replace function painel.leads_por_etapa()
returns table(etapa text, quantidade integer)
language sql stable set search_path = '' as $$
  with lista as (select la.telefone_chave as chave, la.status from mayara.leads_autorizados la),
       sess as (
         select mayara.chave_telefone(s.phone) as chave,
                bool_or(s.consulta_agendada_em is not null) as consulta,
                bool_or(s.estado = 'S7_HANDOFF_HUMANO') as handoff
           from mayara.session_state s group by 1),
       respondeu as (select distinct chave from painel._entradas()),
       classe as (
         select case
                  when l.status = 'sem_interesse' then 'Perdidos'
                  when exists (select 1 from painel.contratos c where c.lead_chave = l.chave) then 'Contrato'
                  when exists (select 1 from mayara.proposta_enviada p where p.telefone_chave = l.chave and p.estado in ('ativa', 'respondeu')) then 'Proposta enviada'
                  when coalesce(s.consulta, false) then 'Consulta'
                  when l.status = 'bloqueado' or coalesce(s.handoff, false) then 'Com a equipe'
                  when r.chave is not null then 'Em conversa'
                  else 'Novo'
                end as etapa
           from lista l
           left join sess s on s.chave = l.chave
           left join respondeu r on r.chave = l.chave)
  select e.etapa, coalesce((select count(*) from classe c where c.etapa = e.etapa), 0)::integer
    from (values (1, 'Novo'), (2, 'Em conversa'), (3, 'Consulta'), (4, 'Com a equipe'), (5, 'Proposta enviada'), (6, 'Contrato'), (7, 'Perdidos')) e(ordem, etapa)
   order by e.ordem
$$;

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
                min(t) filter (where tipo = 'proposta_enviada') as t_proposta,
                min(t) filter (where tipo = 'contrato_fechado') as t_contrato,
                min(t) filter (where tipo = 'perdido') as t_perdido
           from ev group by 1),
       etapas(ordem, etapa, posto) as (values (1, 'Novo', 1), (2, 'Em conversa', 2), (3, 'Consulta', 3), (4, 'Com a equipe', 3), (5, 'Proposta enviada', 4), (6, 'Contrato', 5)),
       entradas as (
         select e.ordem, e.etapa, e.posto, l.*,
                case e.ordem when 1 then l.t_novo when 2 then l.t_conversa when 3 then l.t_consulta when 4 then l.t_equipe when 5 then l.t_proposta else l.t_contrato end as te
           from etapas e cross join lead l),
       dentro as (
         select d.*,
                ((d.posto < 2 and (d.t_conversa is not null or d.t_consulta is not null or d.t_equipe is not null or d.t_proposta is not null or d.t_contrato is not null))
                 or (d.posto < 3 and (d.t_consulta is not null or d.t_equipe is not null or d.t_proposta is not null or d.t_contrato is not null))
                 or (d.posto < 4 and (d.t_proposta is not null or d.t_contrato is not null))
                 or (d.posto < 5 and d.t_contrato is not null)) as avancou
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
