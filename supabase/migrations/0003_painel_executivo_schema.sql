create schema if not exists crm_sync;

create table crm_sync.leads (
  id text primary key,
  name text not null,
  status text not null,
  source text,
  legal_area text,
  channel text,
  urgency_level text,
  lead_score numeric,
  lost_reason text,
  opportunity_amount numeric,
  created_at timestamptz not null,
  won_at timestamptz,
  modified_at timestamptz not null
);

create table crm_sync.meetings (
  id text primary key,
  name text not null,
  status text not null,
  date_start timestamptz,
  date_end timestamptz,
  no_show boolean default false,
  acceptance_status text,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.propostas (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  success_fee_percentage numeric,
  lead_id text references crm_sync.leads(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.contratos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  payment_status text,
  signed_at timestamptz,
  closed_at timestamptz,
  channel text,
  source text,
  lead_id text references crm_sync.leads(id),
  proposal_id text references crm_sync.propostas(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.pagamentos (
  id text primary key,
  name text not null,
  amount numeric,
  status text not null,
  due_date date,
  paid_at timestamptz,
  payment_method text,
  installment_number integer,
  total_installments integer,
  contract_id text references crm_sync.contratos(id),
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.casos_juridicos (
  id text primary key,
  name text not null,
  status text not null,
  risk_level text not null,
  current_phase text,
  legal_area text,
  court text,
  case_number text,
  claim_value numeric,
  next_deadline_at timestamptz,
  last_movement_at timestamptz,
  client_id text,
  responsible_lawyer_id text,
  created_at timestamptz not null,
  modified_at timestamptz not null
);

create table crm_sync.sync_state (
  entity_name text primary key,
  last_synced_at timestamptz not null default '1970-01-01'::timestamptz
);

insert into crm_sync.sync_state (entity_name) values
  ('Lead'), ('Meeting'), ('CProposta'), ('CContrato'), ('CPagamento'), ('CCasoJuridico');

create table crm_sync.sync_failures (
  id bigint generated always as identity primary key,
  entity_name text not null,
  error_message text not null,
  occurred_at timestamptz not null default now()
);

alter table crm_sync.leads enable row level security;
alter table crm_sync.meetings enable row level security;
alter table crm_sync.propostas enable row level security;
alter table crm_sync.contratos enable row level security;
alter table crm_sync.pagamentos enable row level security;
alter table crm_sync.casos_juridicos enable row level security;
alter table crm_sync.sync_state enable row level security;
alter table crm_sync.sync_failures enable row level security;
