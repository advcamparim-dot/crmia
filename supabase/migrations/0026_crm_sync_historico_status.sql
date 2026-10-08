-- supabase/migrations/0026_crm_sync_historico_status.sql
create table crm_sync.lead_historico_status (
  id bigserial primary key,
  lead_id text not null,
  status_anterior text,
  status_novo text,
  mudou_em timestamptz not null default now(),
  origem text not null default 'evento' check (origem in ('evento', 'snapshot'))
);
create index lead_historico_status_lead_idx on crm_sync.lead_historico_status (lead_id, mudou_em);
alter table crm_sync.lead_historico_status enable row level security;
revoke all on crm_sync.lead_historico_status from anon, authenticated;

create or replace function crm_sync.registrar_mudanca_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em)
    values (new.id, null, new.status, coalesce(new.created_at, now()));
  elsif new.status is distinct from old.status then
    insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em)
    values (new.id, old.status, new.status, coalesce(new.modified_at, now()));
  end if;
  return new;
end $$;

create trigger leads_historico_status
  after insert or update of status on crm_sync.leads
  for each row execute function crm_sync.registrar_mudanca_status();

-- ponto de partida para os leads que ja existem: o historico real so existe daqui para frente
insert into crm_sync.lead_historico_status (lead_id, status_anterior, status_novo, mudou_em, origem)
select id, null, status, now(), 'snapshot' from crm_sync.leads;
