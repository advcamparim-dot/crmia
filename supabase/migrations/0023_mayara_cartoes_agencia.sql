-- supabase/migrations/0023_mayara_cartoes_agencia.sql
-- Registro de cada cartao "Novo Lead" lido do grupo da agencia, para conferir depois que nenhum ficou de fora.

create table mayara.cartoes_agencia (
  message_id text primary key,
  telefone text,
  resultado text not null check (resultado in ('criado', 'ja_existia', 'erro_crm', 'ilegivel')),
  motivo text,
  crm_lead_id text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index cartoes_agencia_criado_em_idx on mayara.cartoes_agencia (criado_em desc);
create index cartoes_agencia_telefone_idx on mayara.cartoes_agencia (telefone) where telefone is not null;
alter table mayara.cartoes_agencia enable row level security;
revoke all on mayara.cartoes_agencia from anon, authenticated;

create or replace function mayara.registrar_cartao_agencia(p_message_id text, p_telefone text, p_resultado text, p_motivo text, p_crm_lead_id text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  insert into mayara.cartoes_agencia (message_id, telefone, resultado, motivo, crm_lead_id)
  values (p_message_id, nullif(p_telefone, ''), p_resultado, nullif(p_motivo, ''), nullif(p_crm_lead_id, ''))
  on conflict (message_id) do update
    set resultado = excluded.resultado,
        motivo = excluded.motivo,
        crm_lead_id = coalesce(excluded.crm_lead_id, mayara.cartoes_agencia.crm_lead_id),
        telefone = coalesce(excluded.telefone, mayara.cartoes_agencia.telefone),
        atualizado_em = now();
  return jsonb_build_object('message_id', p_message_id, 'resultado', p_resultado);
end $$;

revoke all on function mayara.registrar_cartao_agencia(text, text, text, text, text) from public, anon, authenticated;
