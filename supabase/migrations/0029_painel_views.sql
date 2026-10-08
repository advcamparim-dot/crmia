-- supabase/migrations/0029_painel_views.sql
create view painel.v_leads as
select id, name as nome, status, campaign as campanha, source as origem, legal_area as area,
       channel as canal, urgency_level as urgencia, lost_reason as motivo_perda,
       created_at as criado_em, modified_at as modificado_em
from crm_sync.leads;

create view painel.v_lead_status_historico as
select lead_id, status_anterior, status_novo, mudou_em, origem from crm_sync.lead_historico_status;

create view painel.v_gasto as
select campanha, mes, valor from painel.gasto_anuncios;

create view painel.v_sync_cursores as
select entity_name as entidade,
       case when last_synced_at <= '1970-01-02'::timestamptz then null else last_synced_at end as ultima_alteracao
from crm_sync.sync_state;

create view painel.v_sync_batimento as
select b.executou_em,
       coalesce(b.executou_em < now() - interval '30 minutes', true) as atrasado
from (select 1) x left join crm_sync.sync_batimento b on true;

revoke all on painel.v_leads, painel.v_lead_status_historico, painel.v_gasto, painel.v_sync_cursores, painel.v_sync_batimento from public, anon, authenticated;
grant select on painel.v_leads, painel.v_lead_status_historico, painel.v_gasto, painel.v_sync_cursores, painel.v_sync_batimento to painel_leitura;
