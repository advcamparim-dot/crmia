-- Contrato fechado: o lead vira Converted no CRM (so avanca, uma vez, nunca sobre Dead) e entra no funil do painel
-- como evento contrato_fechado (data da assinatura).
create or replace function mayara.crm_status_pendentes(p_limite integer default 25)
returns table(crm_lead_id text, status_novo text, motivo_perda text, status_atual text)
language plpgsql stable set search_path = '' as $$
begin
  if coalesce((select valor from mayara.config where chave = 'crm_funil_modo'), 'desligado') = 'desligado' then
    return;
  end if;
  return query
  with fonte as (
    select la.espocrm_lead_id as id, la.telefone_chave as chave, la.status as ls, l.status as atual
      from mayara.leads_autorizados la join crm_sync.leads l on l.id = la.espocrm_lead_id
    union all
    -- cliente com contrato que existe no CRM mas nao esta na lista de atendimento
    select c.crm_lead_id, c.lead_chave, 'ativo', l.status
      from painel.contratos c join crm_sync.leads l on l.id = c.crm_lead_id
     where not exists (select 1 from mayara.leads_autorizados la where la.espocrm_lead_id = c.crm_lead_id)
  ), base as (
    select f.*, 
           exists (select 1 from painel.contratos c where c.lead_chave = f.chave) as contratou,
           exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = f.chave
                    and (s.estado = 'S6_AGENDADO' or s.consulta_agendada_em is not null)) as agendou,
           exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = f.chave
                    and s.estado = 'S7_HANDOFF_HUMANO') as handoff
      from fonte f
  ), desejado as (
    select b.*, case when b.contratou then 'Converted'
                     when b.ls = 'sem_interesse' then 'Dead'
                     when b.agendou then 'Consulta Agendada'
                     when b.ls = 'bloqueado' or b.handoff or mayara._qtd_entradas(b.chave) > 0 then 'In Process'
                end as novo
      from base b
  )
  select d.id, d.novo, case when d.novo = 'Dead' then 'Sem Interesse' end, d.atual
    from desejado d
   where d.novo is not null
     and ((d.novo = 'Dead' and d.atual in ('New', 'In Process', 'Consulta Agendada'))
          or (d.novo <> 'Dead' and mayara._crm_ordem(d.atual) is not null and mayara._crm_ordem(d.novo) > mayara._crm_ordem(d.atual)))
     and not exists (select 1 from mayara.crm_status_log g where g.crm_lead_id = d.id and g.status = d.novo and g.ok)
     and (select count(*) from mayara.crm_status_log g where g.crm_lead_id = d.id and g.status = d.novo and not g.ok
            and g.criado_em > now() - interval '1 hour') < 3
   order by d.id
   limit p_limite;
end $$;

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

  -- contrato fechado: um evento por contrato, na data da assinatura (meio-dia de Sao Paulo)
  insert into painel.eventos (lead_chave, tipo, ocorrido_em, ref, detalhe)
  select c.lead_chave, 'contrato_fechado', ((c.assinado_em::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'),
         'c' || c.id, jsonb_build_object('valor', c.valor_total)
    from painel.contratos c
  on conflict (lead_chave, tipo, ref) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end $$;
