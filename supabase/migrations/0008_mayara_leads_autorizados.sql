-- supabase/migrations/0008_mayara_leads_autorizados.sql
create extension if not exists pgcrypto with schema extensions;

create or replace function mayara.chave_telefone(p_telefone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when d ~ '^55[0-9]{10,11}$' then substr(d, 3, 2) || right(d, 8) else null end
  from (select regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g') as d) t
$$;

create or replace function mayara.set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

create table mayara.leads_autorizados (
  telefone text primary key check (telefone ~ '^\+55[0-9]{10,11}$'),
  telefone_chave text generated always as (mayara.chave_telefone(telefone)) stored not null,
  nome text,
  email text,
  empresa text,
  origem text not null default 'landing_campanha_pj',
  id_campanha text,
  payload_bruto jsonb not null default '{}'::jsonb,
  espocrm_lead_id text,
  status text not null default 'ativo' check (status in ('ativo', 'sem_interesse', 'bloqueado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index leads_autorizados_chave_uq on mayara.leads_autorizados (telefone_chave);
create trigger leads_autorizados_atualizado_em before update on mayara.leads_autorizados
  for each row execute function mayara.set_atualizado_em();

create table mayara.numeros_nao_cadastrados (
  telefone_chave text primary key,
  telefone text not null,
  motivo text not null check (motivo in ('nao_cadastrado', 'sem_interesse', 'bloqueado')),
  primeira_mensagem_em timestamptz not null default now(),
  ultima_mensagem_em timestamptz not null default now(),
  qtd_mensagens int not null default 1,
  ultima_mensagem text,
  avisado_em timestamptz,
  resolvido boolean not null default false
);

create table mayara.leads_rejeitados (
  id bigserial primary key,
  motivo text not null check (motivo in ('telefone_invalido', 'campo_invalido', 'acima_do_teto_por_hora')),
  payload_bruto jsonb not null,
  recebido_em timestamptz not null default now(),
  resolvido boolean not null default false
);

create table mayara.config (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);
insert into mayara.config (chave, valor) values
  ('envio_template_ativo', 'false'),
  ('teto_leads_por_hora', '30');

alter table mayara.leads_autorizados enable row level security;
alter table mayara.numeros_nao_cadastrados enable row level security;
alter table mayara.leads_rejeitados enable row level security;
alter table mayara.config enable row level security;
revoke all on mayara.leads_autorizados, mayara.numeros_nao_cadastrados, mayara.leads_rejeitados, mayara.config from anon, authenticated;

create or replace function mayara.upsert_lead_autorizado(
  p_telefone text, p_nome text, p_email text, p_empresa text,
  p_origem text, p_id_campanha text, p_payload jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare v_status text;
begin
  insert into mayara.leads_autorizados as l (telefone, nome, email, empresa, origem, id_campanha, payload_bruto)
  values (p_telefone, nullif(p_nome, ''), nullif(p_email, ''), nullif(p_empresa, ''),
          coalesce(nullif(p_origem, ''), 'landing_campanha_pj'), nullif(p_id_campanha, ''),
          coalesce(p_payload, '{}'::jsonb))
  on conflict (telefone_chave) do update set
    nome = coalesce(excluded.nome, l.nome),
    email = coalesce(excluded.email, l.email),
    empresa = coalesce(excluded.empresa, l.empresa),
    origem = excluded.origem,
    id_campanha = coalesce(excluded.id_campanha, l.id_campanha),
    payload_bruto = excluded.payload_bruto,
    status = case when l.status = 'sem_interesse' then 'ativo' else l.status end
  returning l.status into v_status;
  return v_status;
end $$;

create or replace function mayara.motivo_bloqueio(p_telefone text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when l.telefone is null then 'nao_cadastrado'
    when l.status = 'ativo' then null
    else l.status
  end
  from (select 1) x
  left join mayara.leads_autorizados l on l.telefone_chave = mayara.chave_telefone(p_telefone)
$$;

create or replace function mayara.registrar_numero_nao_cadastrado(p_telefone text, p_motivo text, p_texto text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_chave text := coalesce(mayara.chave_telefone(p_telefone), regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'));
  v_deve boolean;
begin
  insert into mayara.numeros_nao_cadastrados as n (telefone_chave, telefone, motivo, ultima_mensagem)
  values (v_chave, coalesce(p_telefone, ''), p_motivo, left(coalesce(p_texto, ''), 500))
  on conflict (telefone_chave) do update set
    telefone = excluded.telefone,
    motivo = excluded.motivo,
    ultima_mensagem_em = now(),
    qtd_mensagens = n.qtd_mensagens + 1,
    ultima_mensagem = excluded.ultima_mensagem
  returning (n.avisado_em is null or n.avisado_em < now() - interval '24 hours') into v_deve;
  if v_deve then
    update mayara.numeros_nao_cadastrados set avisado_em = now() where telefone_chave = v_chave;
  end if;
  return v_deve;
end $$;

create or replace function mayara.lead_ativo_da_sessao(p_session_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from mayara.leads_autorizados l
    where l.telefone_chave = mayara.chave_telefone(split_part(p_session_key, ':', 3))
      and l.status = 'ativo'
  )
$$;

create or replace function mayara.dentro_do_teto_por_hora()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select count(*) from mayara.leads_autorizados
          where criado_em > now() - interval '1 hour' and origem <> 'teste')
       < coalesce((select valor::int from mayara.config where chave = 'teto_leads_por_hora'), 30)
$$;
