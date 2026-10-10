-- supabase/migrations/0033_mayara_propostas_abordagem.sql
insert into mayara.config (chave, valor) values ('abordagem_assistida', 'false') on conflict (chave) do nothing;

create table mayara.propostas_abordagem (
  id bigserial primary key,
  telefone text not null,
  telefone_chave text not null,
  nome text,
  crm_lead_id text,
  fatos jsonb not null default '{}'::jsonb,
  lacuna text,
  texto text not null,
  texto_original text,
  estado text not null default 'aberta' check (estado in ('aberta', 'aprovada', 'enviada', 'descartada', 'expirada', 'falhou')),
  criado_em timestamptz not null default now(),
  notificada_em timestamptz,
  lembrete_em timestamptz,
  expira_em timestamptz not null default (now() + interval '24 hours'),
  aprovada_por text,
  encerrada_em timestamptz,
  erro text
);
create unique index propostas_abordagem_uma_por_telefone
  on mayara.propostas_abordagem (telefone_chave) where estado in ('aberta', 'aprovada');
create index propostas_abordagem_estado on mayara.propostas_abordagem (estado, criado_em);
alter table mayara.propostas_abordagem enable row level security;
revoke all on mayara.propostas_abordagem from anon, authenticated;

create or replace function mayara.criar_proposta(
  p_telefone text, p_nome text, p_crm_lead_id text, p_texto text, p_fatos jsonb, p_lacuna text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_chave text := mayara.chave_telefone(p_telefone);
  v_texto text := btrim(coalesce(p_texto, ''));
  v_status text;
  v_id bigint;
begin
  if v_chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 700 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  select status into v_status from mayara.leads_autorizados where telefone_chave = v_chave;
  if v_status is not null and v_status <> 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  if exists (select 1 from mayara.session_state s
             where mayara.chave_telefone(s.phone) = v_chave
               and s.last_lead_message_at > now() - interval '48 hours') then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_recente');
  end if;
  if exists (select 1 from mayara.leads_autorizados la where la.telefone_chave = v_chave and la.abordagem_ate is not null)
     or exists (select 1 from mayara.propostas_abordagem p
                where p.telefone_chave = v_chave and p.estado in ('aberta', 'aprovada', 'enviada')) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_abordado');
  end if;
  insert into mayara.propostas_abordagem (telefone, telefone_chave, nome, crm_lead_id, fatos, lacuna, texto, texto_original)
  values (p_telefone, v_chave, nullif(btrim(coalesce(p_nome, '')), ''), nullif(btrim(coalesce(p_crm_lead_id, '')), ''),
          coalesce(p_fatos, '{}'::jsonb), nullif(btrim(coalesce(p_lacuna, '')), ''), v_texto, v_texto)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'motivo', 'ja_abordado');
end $$;

revoke all on function mayara.criar_proposta(text, text, text, text, jsonb, text) from public, anon, authenticated;
