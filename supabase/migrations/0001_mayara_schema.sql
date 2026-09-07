-- supabase/migrations/0001_mayara_schema.sql
create schema if not exists mayara;

create table mayara.session_state (
  session_key text primary key,
  estado text not null,
  fatos_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mayara.bridge_responses (
  session_key text primary key,
  output text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mayara.crm_retry_failed (
  id bigserial primary key,
  payload jsonb not null,
  motivo_falha text,
  tentativas int not null default 0,
  criado_em timestamptz not null default now()
);

-- trigger genérico de updated_at
create or replace function mayara.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_session_state_updated_at
  before update on mayara.session_state
  for each row execute function mayara.set_updated_at();

create trigger trg_bridge_responses_updated_at
  before update on mayara.bridge_responses
  for each row execute function mayara.set_updated_at();

-- RLS ligado em tudo, sem nenhuma policy (deny-all para anon/authenticated;
-- a conexão do n8n usa o usuário postgres direto, que não passa por RLS)
alter table mayara.session_state enable row level security;
alter table mayara.bridge_responses enable row level security;
alter table mayara.crm_retry_failed enable row level security;
