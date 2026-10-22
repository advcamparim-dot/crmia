-- Contratos e parcelas (fonte de receita do painel). Gravados pela Central (apos o "sim") via painel.contrato_registrar;
-- o painel so marca/desfaz pagamento de parcela, com auditoria.
create table if not exists painel.contratos (
  id bigserial primary key,
  lead_chave text not null,
  lead_nome text,
  telefone text,
  crm_lead_id text,
  valor_total numeric(12,2) not null check (valor_total > 0 and valor_total <= 5000000),
  assinado_em date not null,
  origem text not null default 'whatsapp',
  criado_em timestamptz not null default now()
);
create index if not exists contratos_assinado_idx on painel.contratos (assinado_em);
create index if not exists contratos_lead_idx on painel.contratos (lead_chave);

create table if not exists painel.parcelas (
  id bigserial primary key,
  contrato_id bigint not null references painel.contratos (id),
  numero integer not null check (numero between 0 and 120), -- 0 = entrada
  valor numeric(12,2) not null check (valor > 0),
  vencimento date not null,
  pago_em date,
  unique (contrato_id, numero)
);
create index if not exists parcelas_vencimento_idx on painel.parcelas (vencimento) where pago_em is null;

create table if not exists painel.parcelas_log (
  id bigserial primary key,
  parcela_id bigint not null,
  acao text not null check (acao in ('marcar_paga', 'desfazer')),
  de_pago_em date,
  para_pago_em date,
  quem text not null,
  quando timestamptz not null default now()
);
alter table painel.contratos enable row level security;
alter table painel.parcelas enable row level security;
alter table painel.parcelas_log enable row level security;
revoke all on painel.contratos, painel.parcelas, painel.parcelas_log from public, anon, authenticated;

create or replace function painel._hoje() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- paga | atrasada | a_receber. Parcela que vence hoje nao esta atrasada.
create or replace function painel.parcela_status(p_pago_em date, p_vencimento date, p_hoje date default null)
returns text language sql stable set search_path = '' as $$
  select case when p_pago_em is not null then 'paga'
              when p_vencimento < coalesce(p_hoje, painel._hoje()) then 'atrasada'
              else 'a_receber' end
$$;

-- p_parcelas = [{"numero":0,"valor":5000,"vencimento":"2026-10-20","pago_em":"2026-10-20"}, ...] (numero 0 = entrada).
create or replace function painel.contrato_registrar(p_telefone text, p_nome text, p_crm_lead_id text, p_total numeric,
                                                      p_assinado_em date, p_parcelas jsonb, p_origem text default 'whatsapp')
returns bigint language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_hoje date := painel._hoje();
  v_soma numeric; v_n integer; v_id bigint; v_item jsonb; v_pago date; v_venc date;
begin
  if v_chave is null then raise exception 'telefone invalido'; end if;
  if p_total is null or p_total <= 0 or p_total > 5000000 then raise exception 'total invalido'; end if;
  if p_assinado_em is null then raise exception 'data de assinatura ausente'; end if;
  if p_parcelas is null or jsonb_typeof(p_parcelas) <> 'array' then raise exception 'parcelas invalidas'; end if;
  v_n := jsonb_array_length(p_parcelas);
  if v_n < 1 or v_n > 121 then raise exception 'quantidade de parcelas invalida (1 a 121 com a entrada)'; end if;

  select coalesce(sum(round((x ->> 'valor')::numeric, 2)), 0) into v_soma from jsonb_array_elements(p_parcelas) x;
  if v_soma <> p_total then
    raise exception 'soma_nao_bate: parcelas somam % e o total e %', v_soma, p_total;
  end if;

  select id into v_id from painel.contratos
   where lead_chave = v_chave and valor_total = p_total and assinado_em = p_assinado_em
     and criado_em > now() - interval '10 minutes' order by id desc limit 1;
  if v_id is not null then return v_id; end if;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if coalesce((v_item ->> 'valor')::numeric, 0) <= 0 then raise exception 'parcela com valor invalido'; end if;
    v_venc := (v_item ->> 'vencimento')::date;
    if v_venc is null or v_venc > v_hoje + interval '10 years' then raise exception 'vencimento invalido'; end if;
    v_pago := nullif(v_item ->> 'pago_em', '')::date;
    if v_pago is not null and v_pago > v_hoje then raise exception 'pagamento no futuro'; end if;
  end loop;

  insert into painel.contratos (lead_chave, lead_nome, telefone, crm_lead_id, valor_total, assinado_em, origem)
  values (v_chave, nullif(btrim(p_nome), ''), p_telefone, nullif(btrim(p_crm_lead_id), ''), p_total, p_assinado_em, coalesce(p_origem, 'whatsapp'))
  returning id into v_id;

  insert into painel.parcelas (contrato_id, numero, valor, vencimento, pago_em)
  select v_id, (x ->> 'numero')::integer, round((x ->> 'valor')::numeric, 2), (x ->> 'vencimento')::date, nullif(x ->> 'pago_em', '')::date
    from jsonb_array_elements(p_parcelas) x;
  return v_id;
end $$;

create or replace function painel.parcela_marcar_paga(p_id bigint, p_data date, p_quem text)
returns void language plpgsql set search_path = '' as $$
declare v_atual date; v_ok boolean;
begin
  if p_data is null or p_data > painel._hoje() then raise exception 'data de pagamento invalida'; end if;
  select pago_em, true into v_atual, v_ok from painel.parcelas where id = p_id for update;
  if v_ok is not true then raise exception 'parcela nao encontrada'; end if;
  if v_atual is not distinct from p_data then return; end if;
  update painel.parcelas set pago_em = p_data where id = p_id;
  insert into painel.parcelas_log (parcela_id, acao, de_pago_em, para_pago_em, quem) values (p_id, 'marcar_paga', v_atual, p_data, coalesce(nullif(p_quem, ''), 'painel'));
end $$;

create or replace function painel.parcela_desfazer(p_id bigint, p_quem text)
returns void language plpgsql set search_path = '' as $$
declare v_atual date; v_ok boolean;
begin
  select pago_em, true into v_atual, v_ok from painel.parcelas where id = p_id for update;
  if v_ok is not true then raise exception 'parcela nao encontrada'; end if;
  if v_atual is null then return; end if;
  update painel.parcelas set pago_em = null where id = p_id;
  insert into painel.parcelas_log (parcela_id, acao, de_pago_em, para_pago_em, quem) values (p_id, 'desfazer', v_atual, null, coalesce(nullif(p_quem, ''), 'painel'));
end $$;

revoke all on function painel._hoje(), painel.parcela_status(date, date, date), painel.contrato_registrar(text, text, text, numeric, date, jsonb, text),
  painel.parcela_marcar_paga(bigint, date, text), painel.parcela_desfazer(bigint, text) from public, anon, authenticated;
grant execute on function painel._hoje(), painel.parcela_status(date, date, date), painel.parcela_marcar_paga(bigint, date, text),
  painel.parcela_desfazer(bigint, text) to painel_leitura;
