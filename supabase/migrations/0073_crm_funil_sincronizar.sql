-- Sincroniza o funil do CRM (EspoCRM) com o que acontece no atendimento da Mayara.
-- Regras: so avanca o status (New < In Process < Consulta Agendada < Consulta Realizada < Converted); nunca desfaz
-- o que a equipe marcou a mao; 'Dead' so para lead sem_interesse que ainda estava em andamento; cada status e aplicado
-- no maximo uma vez por lead (se a equipe reverter, a automacao nao briga). Desligada por padrao.
insert into mayara.config (chave, valor) values ('crm_funil_modo', 'desligado') on conflict (chave) do nothing;

create table if not exists mayara.crm_status_log (
  id bigserial primary key,
  crm_lead_id text not null,
  status text not null,
  ok boolean not null,
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists crm_status_log_lead_idx on mayara.crm_status_log (crm_lead_id, status, criado_em desc);
alter table mayara.crm_status_log enable row level security;
revoke all on mayara.crm_status_log from public, anon, authenticated;

create or replace function mayara._crm_ordem(p_status text)
returns integer language sql immutable set search_path = '' as $$
  select case p_status when 'New' then 0 when 'In Process' then 1 when 'Consulta Agendada' then 2
                       when 'Consulta Realizada' then 3 when 'Converted' then 4 else null end
$$;

create or replace function mayara.crm_status_pendentes(p_limite integer default 25)
returns table(crm_lead_id text, status_novo text, motivo_perda text, status_atual text)
language plpgsql stable set search_path = '' as $$
begin
  if coalesce((select valor from mayara.config where chave = 'crm_funil_modo'), 'desligado') = 'desligado' then
    return;
  end if;
  return query
  with base as (
    select la.espocrm_lead_id as id, la.telefone_chave as chave, la.status as ls, l.status as atual,
           exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = la.telefone_chave
                    and (s.estado = 'S6_AGENDADO' or s.consulta_agendada_em is not null)) as agendou,
           exists (select 1 from mayara.session_state s where mayara.chave_telefone(s.phone) = la.telefone_chave
                    and s.estado = 'S7_HANDOFF_HUMANO') as handoff
      from mayara.leads_autorizados la
      join crm_sync.leads l on l.id = la.espocrm_lead_id
  ), desejado as (
    select b.*, case when b.ls = 'sem_interesse' then 'Dead'
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

create or replace function mayara.crm_status_registrar(p_crm_lead_id text, p_status text, p_ok boolean, p_erro text)
returns void language sql set search_path = '' as $$
  insert into mayara.crm_status_log (crm_lead_id, status, ok, erro)
  values (p_crm_lead_id, p_status, p_ok, left(p_erro, 300))
$$;

revoke all on function mayara._crm_ordem(text), mayara.crm_status_pendentes(integer), mayara.crm_status_registrar(text, text, boolean, text)
  from public, anon, authenticated;
