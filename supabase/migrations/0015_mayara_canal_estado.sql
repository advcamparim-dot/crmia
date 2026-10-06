-- supabase/migrations/0015_mayara_canal_estado.sql
-- Estado da conexao do canal (aviso de linha caida sem repeticao), origem no log de envios e retencao.

create table mayara.canal_estado (
  canal_id text primary key,
  estado text not null,
  atualizado_em timestamptz not null default now(),
  alertado_em timestamptz
);
alter table mayara.canal_estado enable row level security;
revoke all on mayara.canal_estado from anon, authenticated;

create or replace function mayara.registrar_estado_canal(p_canal_id text, p_estado text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_estado text := lower(coalesce(p_estado, ''));
  v_ant text;
  v_alert timestamptz;
  v_alertar boolean := false;
  v_recup boolean := false;
begin
  if v_estado not in ('open', 'connecting', 'close') then
    select estado into v_ant from mayara.canal_estado where canal_id = p_canal_id;
    return jsonb_build_object('estado', 'desconhecido', 'anterior', v_ant, 'alertar', false, 'recuperado', false);
  end if;
  select estado, alertado_em into v_ant, v_alert from mayara.canal_estado where canal_id = p_canal_id for update;
  if v_estado = 'close' and coalesce(v_ant, '') <> 'close'
     and (v_alert is null or v_alert < now() - interval '10 minutes') then
    v_alertar := true;
  end if;
  v_recup := (v_estado = 'open' and v_ant = 'close');
  insert into mayara.canal_estado (canal_id, estado, atualizado_em, alertado_em)
  values (p_canal_id, v_estado, now(), case when v_alertar then now() end)
  on conflict (canal_id) do update
    set estado = excluded.estado,
        atualizado_em = now(),
        alertado_em = case when v_alertar then now() else mayara.canal_estado.alertado_em end;
  return jsonb_build_object('estado', v_estado, 'anterior', v_ant, 'alertar', v_alertar, 'recuperado', v_recup);
end $$;

alter table mayara.envios_log add column origem text;

create or replace function mayara.registrar_envio_com_origem(p_canal_id text, p_destino text, p_tipo text, p_resultado jsonb, p_origem text)
returns jsonb language plpgsql set search_path = '' as $$
begin
  insert into mayara.envios_log (canal_id, destino_chave, tipo, ok, erro, provedor_message_id, origem)
  values (
    p_canal_id,
    coalesce(mayara.chave_telefone(p_destino), regexp_replace(coalesce(p_destino, ''), '[^0-9]', '', 'g')),
    p_tipo,
    coalesce((p_resultado ->> 'ok')::boolean, false),
    p_resultado #>> '{error,message}',
    p_resultado #>> '{messages,0,id}',
    nullif(p_origem, '')
  );
  return p_resultado;
end $$;

create or replace function mayara.limpar_eventos_canal(p_dias int default 90)
returns int language plpgsql set search_path = '' as $$
declare n int;
begin
  delete from mayara.canal_eventos where criado_em < now() - make_interval(days => p_dias);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function mayara.registrar_estado_canal(text, text) from public, anon, authenticated;
revoke all on function mayara.registrar_envio_com_origem(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function mayara.limpar_eventos_canal(int) from public, anon, authenticated;
