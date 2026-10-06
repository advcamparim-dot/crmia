-- supabase/migrations/0013_mayara_canal_eventos.sql
-- Fase 2 da camada de canal: recebimento pela Evolution em modo de observacao.
-- O canal do escritorio nasce INATIVO (pode_enviar recusa qualquer envio) e os eventos
-- ficam registrados sem o conteudo das mensagens.

create table mayara.canal_eventos (
  id bigserial primary key,
  canal_id text not null,
  provedor text not null,
  resultado text not null check (resultado in ('aceito', 'descartado')),
  motivo text,
  remetente_chave text,
  tipo text,
  tamanho_texto int,
  requer_humano boolean,
  criado_em timestamptz not null default now()
);
create index canal_eventos_canal_tempo_idx on mayara.canal_eventos (canal_id, criado_em desc);

alter table mayara.canal_eventos enable row level security;
revoke all on mayara.canal_eventos from anon, authenticated;
revoke all on sequence mayara.canal_eventos_id_seq from anon, authenticated;

insert into mayara.canais (canal_id, provedor, rotulo, telefone, ativo) values
  ('escritorio', 'evolution', 'Escritorio (Evolution, em observacao)', '+5514996177022', false)
on conflict (canal_id) do nothing;

create or replace function mayara.conferir_segredo_canal(p_segredo text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    p_segredo is not null
    and p_segredo <> ''
    and exists (
      select 1 from mayara.config
      where chave = 'evolution_segredo_sha256'
        and valor = encode(extensions.digest(p_segredo, 'sha256'), 'hex')
    ),
    false);
$$;

create or replace function mayara.registrar_evento_canal(
  p_canal_id text, p_provedor text, p_resultado text, p_motivo text,
  p_remetente text, p_tipo text, p_tamanho int, p_requer_humano boolean)
returns void language plpgsql set search_path = '' as $$
begin
  insert into mayara.canal_eventos (canal_id, provedor, resultado, motivo, remetente_chave, tipo, tamanho_texto, requer_humano)
  values (p_canal_id, p_provedor, p_resultado, p_motivo, mayara.chave_telefone(p_remetente), p_tipo, p_tamanho, p_requer_humano);
end $$;

revoke all on function mayara.conferir_segredo_canal(text) from public, anon, authenticated;
revoke all on function mayara.registrar_evento_canal(text, text, text, text, text, text, int, boolean) from public, anon, authenticated;
