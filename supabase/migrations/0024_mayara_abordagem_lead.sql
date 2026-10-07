-- supabase/migrations/0024_mayara_abordagem_lead.sql
-- Abordagem controlada de um lead: por ordem do administrador, a Mayara pode mandar a primeira mensagem
-- a um lead autorizado que nao escreveu nas ultimas horas, dentro de uma janela de tempo limitada.

alter table mayara.leads_autorizados add column abordagem_ate timestamptz;

create or replace function mayara.autorizar_abordagem(p_telefone text, p_nome text, p_espocrm_lead_id text, p_horas int default 24)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  insert into mayara.leads_autorizados (telefone, nome, origem, espocrm_lead_id)
  values (p_telefone, nullif(p_nome, ''), 'abordagem_administrador', nullif(p_espocrm_lead_id, ''))
  on conflict (telefone_chave) do update set
    nome = coalesce(excluded.nome, mayara.leads_autorizados.nome),
    espocrm_lead_id = coalesce(excluded.espocrm_lead_id, mayara.leads_autorizados.espocrm_lead_id);
  -- so abre a janela para lead ativo: quem pediu para parar (sem_interesse) ou foi assumido pela equipe (bloqueado) nao e reaberto aqui
  update mayara.leads_autorizados
     set abordagem_ate = now() + make_interval(hours => greatest(coalesce(p_horas, 24), 1))
   where telefone_chave = mayara.chave_telefone(p_telefone) and status = 'ativo'
  returning status into v_status;
  if v_status is null then
    select status into v_status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone(p_telefone);
    return jsonb_build_object('status', v_status, 'abordagem_liberada', false);
  end if;
  return jsonb_build_object('status', v_status, 'abordagem_liberada', true);
end $$;

create or replace function mayara.iniciar_sessao_reativacao(p_session_key text, p_phone text, p_fatos jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  insert into mayara.session_state (session_key, phone, phone_number_id, estado, fatos_json, last_lead_message_at)
  values (p_session_key, p_phone, nullif(split_part(p_session_key, ':', 2), ''), 'S1_ENGAJADO', coalesce(p_fatos, '{}'::jsonb), now())
  on conflict (session_key) do update set
    fatos_json = mayara.session_state.fatos_json || coalesce(p_fatos, '{}'::jsonb),
    phone = coalesce(mayara.session_state.phone, excluded.phone),
    phone_number_id = coalesce(mayara.session_state.phone_number_id, excluded.phone_number_id);
end $$;

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
              and (s.last_lead_message_at > now() - make_interval(hours => v_janela)
                   or s.consulta_agendada_em > now()))
    or exists (select 1 from mayara.leads_autorizados la
               where la.telefone_chave = v_chave and la.status = 'ativo' and la.abordagem_ate > now())
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

revoke all on function mayara.autorizar_abordagem(text, text, text, int) from public, anon, authenticated;
revoke all on function mayara.iniciar_sessao_reativacao(text, text, jsonb) from public, anon, authenticated;
revoke all on function mayara.pode_enviar(text, text, text) from public, anon, authenticated;
