-- supabase/migrations/0027_crm_sync_campanha_batimento.sql
alter table crm_sync.leads add column campaign text;

-- O cursor de sync_state so avanca quando ha alteracao no CRM; ele nao prova que a sincronizacao esta viva.
-- O batimento e gravado a cada execucao do workflow (a cada 5 min).
create table crm_sync.sync_batimento (
  id int primary key default 1 check (id = 1),
  executou_em timestamptz not null default now()
);
alter table crm_sync.sync_batimento enable row level security;
revoke all on crm_sync.sync_batimento from anon, authenticated;

create or replace function crm_sync.registrar_batimento()
returns void language plpgsql set search_path = '' as $$
begin
  insert into crm_sync.sync_batimento (id, executou_em) values (1, now())
  on conflict (id) do update set executou_em = now();
end $$;
revoke all on function crm_sync.registrar_batimento() from public, anon, authenticated;
