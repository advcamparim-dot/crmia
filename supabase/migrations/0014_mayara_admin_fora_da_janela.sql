-- supabase/migrations/0014_mayara_admin_fora_da_janela.sql
-- Administrador ativo fica fora da regra de janela de 48 h do provedor evolution:
-- alertas de erro e de falha de agendamento precisam chegar mesmo sem conversa recente.
-- O teto por minuto e a exigencia de canal ativo continuam valendo.

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
    exists (select 1 from mayara.administradores a
            where a.ativo and a.telefone_chave = v_chave)
    or exists (select 1 from mayara.session_state s
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

revoke all on function mayara.pode_enviar(text, text, text) from public, anon, authenticated;
