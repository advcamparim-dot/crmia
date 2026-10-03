-- supabase/migrations/0012_mayara_canais.sql
-- Camada de canal do WhatsApp: linhas, log de envios, textos de template e politica de envio.

create table mayara.canais (
  canal_id text primary key,
  provedor text not null check (provedor in ('meta', 'evolution')),
  rotulo text not null,
  telefone text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table mayara.envios_log (
  id bigserial primary key,
  canal_id text not null,
  destino_chave text not null,
  tipo text not null check (tipo in ('texto', 'template')),
  ok boolean not null,
  erro text,
  provedor_message_id text,
  criado_em timestamptz not null default now()
);
create index envios_log_canal_tempo_idx on mayara.envios_log (canal_id, criado_em desc);

create table mayara.canal_templates (
  nome text primary key,
  corpo text not null
);

alter table mayara.canais enable row level security;
alter table mayara.envios_log enable row level security;
alter table mayara.canal_templates enable row level security;
revoke all on mayara.canais, mayara.envios_log, mayara.canal_templates from anon, authenticated;
revoke all on sequence mayara.envios_log_id_seq from anon, authenticated;

insert into mayara.config (chave, valor) values
  ('evolution_janela_horas', '48'),
  ('evolution_teto_por_minuto', '20')
on conflict (chave) do nothing;

insert into mayara.canais (canal_id, provedor, rotulo, telefone) values
  ('1365007506685934', 'meta', 'Linha Meta (numero de teste)', '+15556566060')
on conflict (canal_id) do nothing;

create or replace function mayara.pode_enviar(p_canal_id text, p_destino text, p_tipo text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v mayara.canais%rowtype;
  v_chave text := mayara.chave_telefone(p_destino);
  v_janela int := coalesce((select valor::int from mayara.config where chave = 'evolution_janela_horas'), 48);
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'evolution_teto_por_minuto'), 20);
begin
  select * into v from mayara.canais where canal_id = p_canal_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'canal_desconhecido');
  end if;
  if not v.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'canal_inativo');
  end if;
  if v.provedor = 'meta' then
    return jsonb_build_object('ok', true, 'provedor', 'meta');
  end if;
  if v_chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;
  if not (
    exists (select 1 from mayara.session_state s
            where mayara.chave_telefone(s.phone) = v_chave
              and s.last_lead_message_at > now() - make_interval(hours => v_janela))
    or exists (select 1 from mayara.comandos_log c
               where c.admin_chave = v_chave
                 and c.criado_em > now() - make_interval(hours => v_janela))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela');
  end if;
  if (select count(*) from mayara.envios_log l
       where l.canal_id = p_canal_id and l.criado_em > now() - interval '1 minute') >= v_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_por_minuto');
  end if;
  return jsonb_build_object('ok', true, 'provedor', 'evolution');
end $$;

create or replace function mayara.registrar_envio(p_canal_id text, p_destino text, p_tipo text, p_resultado jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, erro, provedor_message_id)
  values (
    p_canal_id,
    coalesce(mayara.chave_telefone(p_destino), regexp_replace(coalesce(p_destino, ''), '[^0-9]', '', 'g')),
    p_tipo,
    coalesce((p_resultado ->> 'ok')::boolean, false),
    p_resultado #>> '{error,message}',
    p_resultado #>> '{messages,0,id}'
  );
  return p_resultado;
end $$;

revoke all on function mayara.pode_enviar(text, text, text) from public, anon, authenticated;
revoke all on function mayara.registrar_envio(text, text, text, jsonb) from public, anon, authenticated;
