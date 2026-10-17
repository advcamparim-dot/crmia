-- supabase/migrations/0059_mayara_abordagem_automatica.sql
insert into mayara.config (chave, valor) values
  ('abordagem_automatica', 'false'),
  ('abordagem_auto_teto_hora', '10')
on conflict (chave) do nothing;

create or replace function mayara.abordagem_auto_proximo(p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  v_teto int := coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10);
  v_status text; v_motivo text; r jsonb;
begin
  if coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'desligada');
  end if;
  if coalesce((select valor from mayara.config where chave = 'abordagem_assistida'), 'false') <> 'true' then
    return jsonb_build_object('enviar', false, 'motivo', 'assistida_desligada');
  end if;
  if coalesce((select estado from mayara.canal_estado where canal_id = 'escritorio'), 'close') <> 'open' then
    return jsonb_build_object('enviar', false, 'motivo', 'canal_fechado');
  end if;
  if not mayara.resposta_permitida(p_agora) then
    return jsonb_build_object('enviar', false, 'motivo', 'fora_do_expediente');
  end if;
  if (select count(*) from mayara.envios_log e
       where e.origem = 'abordagem_automatica' and e.ok and e.criado_em > p_agora - interval '1 hour') >= v_teto then
    return jsonb_build_object('enviar', false, 'motivo', 'teto_hora');
  end if;

  select * into p
    from mayara.propostas_abordagem x
   where x.estado = 'aberta'
   order by x.criado_em, x.id
   limit 1
   for update skip locked;
  if not found then
    return jsonb_build_object('enviar', false, 'motivo', 'fila_vazia');
  end if;

  select la.status into v_status from mayara.leads_autorizados la where la.telefone_chave = p.telefone_chave;
  v_motivo := case
    when exists (select 1 from mayara.administradores a where a.telefone_chave = p.telefone_chave) then 'administrador'
    when v_status is not null and v_status <> 'ativo' then 'lead_inativo'
    when exists (select 1 from mayara.session_state s
                  where mayara.chave_telefone(s.phone) = p.telefone_chave
                    and s.last_lead_message_at > p_agora - interval '48 hours') then 'conversa_recente'
    else null
  end;
  if v_motivo is not null then
    update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = p_agora, erro = v_motivo where id = p.id;
    return jsonb_build_object('enviar', false, 'motivo', 'descartada', 'proposta_id', p.id);
  end if;

  r := mayara.aprovar_proposta(p.id, 'automatico');
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('enviar', false, 'motivo', coalesce(r ->> 'motivo', 'nao_aprovada'), 'proposta_id', p.id);
  end if;
  return jsonb_build_object('enviar', true, 'proposta_id', p.id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                            'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
end $$;

create or replace function mayara.abordagem_auto_registrar(p_proposta_id bigint, p_ok boolean, p_erro text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_resposta text; v_ultimas text[]; v_pausada boolean := false;
begin
  v_resposta := mayara.finalizar_envio_proposta(p_proposta_id, p_ok, p_erro);
  if not p_ok then
    select array_agg(x.estado order by x.encerrada_em desc nulls last, x.id desc) into v_ultimas
      from (select id, estado, encerrada_em from mayara.propostas_abordagem
             where aprovada_por = 'automatico' and estado in ('enviada', 'falhou')
             order by encerrada_em desc nulls last, id desc limit 3) x;
    if coalesce(array_length(v_ultimas, 1), 0) = 3 and v_ultimas = array['falhou', 'falhou', 'falhou'] then
      update mayara.config set valor = 'false' where chave = 'abordagem_automatica';
      v_pausada := true;
    end if;
  end if;
  return jsonb_build_object('resposta', v_resposta, 'pausada', v_pausada);
end $$;

create or replace function mayara.abordagem_auto_resumo(p_horas int default 24)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'ligada', coalesce((select valor from mayara.config where chave = 'abordagem_automatica'), 'false') = 'true',
    'teto_hora', coalesce((select valor::int from mayara.config where chave = 'abordagem_auto_teto_hora'), 10),
    'enviadas', (select count(*) from mayara.propostas_abordagem p
                  where p.aprovada_por = 'automatico' and p.estado = 'enviada'
                    and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'falhas', (select count(*) from mayara.propostas_abordagem p
                where p.aprovada_por = 'automatico' and p.estado = 'falhou'
                  and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'descartadas', (select count(*) from mayara.propostas_abordagem p
                     where p.estado = 'descartada' and p.erro in ('administrador', 'lead_inativo', 'conversa_recente')
                       and p.encerrada_em > now() - make_interval(hours => greatest(p_horas, 1))),
    'abertas', (select count(*) from mayara.propostas_abordagem p where p.estado = 'aberta')
  )
$$;

revoke all on function mayara.abordagem_auto_proximo(timestamptz) from public, anon, authenticated;
revoke all on function mayara.abordagem_auto_registrar(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.abordagem_auto_resumo(int) from public, anon, authenticated;
