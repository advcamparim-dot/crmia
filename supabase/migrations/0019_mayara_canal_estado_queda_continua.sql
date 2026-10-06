-- supabase/migrations/0019_mayara_canal_estado_queda_continua.sql
-- Durante uma queda continua a Evolution alterna close/connecting; antes disso o aviso se repetia a cada 10 min.
-- Agora so realerta depois de uma reconexao (open) real.

alter table mayara.canal_estado add column ultimo_open_em timestamptz;

create or replace function mayara.registrar_estado_canal(p_canal_id text, p_estado text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_estado text := lower(coalesce(p_estado, ''));
  v_ant text;
  v_alert timestamptz;
  v_open timestamptz;
  v_alertar boolean := false;
  v_recup boolean := false;
begin
  if v_estado not in ('open', 'connecting', 'close') then
    select estado into v_ant from mayara.canal_estado where canal_id = p_canal_id;
    return jsonb_build_object('estado', 'desconhecido', 'anterior', v_ant, 'alertar', false, 'recuperado', false);
  end if;
  select estado, alertado_em, ultimo_open_em into v_ant, v_alert, v_open
    from mayara.canal_estado where canal_id = p_canal_id for update;
  if v_estado = 'close' and coalesce(v_ant, '') <> 'close'
     and (v_alert is null or (v_alert < now() - interval '10 minutes' and v_open is not null and v_open > v_alert)) then
    v_alertar := true;
  end if;
  v_recup := (v_estado = 'open' and v_ant = 'close');
  insert into mayara.canal_estado (canal_id, estado, atualizado_em, alertado_em, ultimo_open_em)
  values (p_canal_id, v_estado, now(), case when v_alertar then now() end, case when v_estado = 'open' then now() end)
  on conflict (canal_id) do update
    set estado = excluded.estado,
        atualizado_em = now(),
        alertado_em = case when v_alertar then now() else mayara.canal_estado.alertado_em end,
        ultimo_open_em = case when v_estado = 'open' then now() else mayara.canal_estado.ultimo_open_em end;
  return jsonb_build_object('estado', v_estado, 'anterior', v_ant, 'alertar', v_alertar, 'recuperado', v_recup);
end $$;

revoke all on function mayara.registrar_estado_canal(text, text) from public, anon, authenticated;
