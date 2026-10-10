-- supabase/migrations/0035_mayara_propostas_acoes.sql
create or replace function mayara.aprovar_proposta(p_id bigint, p_autor text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  a jsonb;
begin
  perform mayara.expirar_propostas();
  select * into p from mayara.propostas_abordagem where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;
  if p.estado in ('aprovada', 'enviada') then
    return jsonb_build_object('ok', false, 'motivo', 'ja_aprovada');
  end if;
  if p.estado = 'expirada' then
    return jsonb_build_object('ok', false, 'motivo', 'expirada');
  end if;
  if p.estado <> 'aberta' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_aberta');
  end if;
  a := mayara.autorizar_abordagem(p.telefone, p.nome, p.crm_lead_id, 24);
  if (a ->> 'abordagem_liberada') <> 'true' then
    update mayara.propostas_abordagem
       set estado = 'descartada', encerrada_em = now(), erro = 'lead_' || coalesce(a ->> 'status', 'inativo')
     where id = p.id;
    return jsonb_build_object('ok', false, 'motivo', 'lead_inativo');
  end if;
  perform mayara.iniciar_sessao_reativacao('whatsapp:escritorio:' || p.telefone, p.telefone, p.fatos);
  update mayara.propostas_abordagem set estado = 'aprovada', aprovada_por = p_autor where id = p.id;
  return jsonb_build_object('ok', true, 'id', p.id, 'destino', p.telefone, 'texto', p.texto,
                            'nome', p.nome, 'crm_lead_id', p.crm_lead_id);
end $$;

create or replace function mayara.confirmar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare p mayara.propostas_abordagem%rowtype;
begin
  select * into p from mayara.propostas_abordagem where id = p_id for update;
  if not found then
    return 'Proposta não encontrada.';
  end if;
  if p.estado <> 'aprovada' then
    return 'Nada a confirmar: a proposta está ' || p.estado || '.';
  end if;
  if p_ok then
    update mayara.propostas_abordagem set estado = 'enviada', encerrada_em = now() where id = p.id;
    insert into public.n8n_chat_histories (session_id, message, created_at)
    values ('whatsapp:escritorio:' || p.telefone,
            jsonb_build_object('type', 'ai', 'content', p.texto, 'tool_calls', '[]'::jsonb,
                               'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb,
                               'invalid_tool_calls', '[]'::jsonb),
            now());
    return 'Enviada.';
  end if;
  update mayara.propostas_abordagem
     set estado = 'falhou', encerrada_em = now(), erro = left(coalesce(p_erro, 'erro_desconhecido'), 300)
   where id = p.id;
  return 'O envio falhou; a proposta foi marcada como falhou.';
end $$;

create or replace function mayara.descartar_proposta(p_id bigint)
returns text language plpgsql set search_path = '' as $$
declare v_est text;
begin
  select estado into v_est from mayara.propostas_abordagem where id = p_id for update;
  if v_est is null then
    return 'Não achei a proposta ' || p_id::text || '.';
  end if;
  if v_est <> 'aberta' then
    return 'A proposta ' || p_id::text || ' não está aberta (está ' || v_est || ').';
  end if;
  update mayara.propostas_abordagem set estado = 'descartada', encerrada_em = now() where id = p_id;
  return 'Ok, descartei a proposta ' || p_id::text || '. Nada foi enviado.';
end $$;

create or replace function mayara.editar_proposta(p_id bigint, p_texto text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_texto text := btrim(coalesce(p_texto, ''));
begin
  if not exists (select 1 from mayara.propostas_abordagem where id = p_id and estado = 'aberta') then
    return jsonb_build_object('ok', false, 'motivo', 'nao_esta_aberta');
  end if;
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;
  if char_length(v_texto) > 700 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo');
  end if;
  if lower(v_texto) like '%http%' or lower(v_texto) like '%www.%' then
    return jsonb_build_object('ok', false, 'motivo', 'texto_invalido');
  end if;
  update mayara.propostas_abordagem set texto = v_texto, lembrete_em = null where id = p_id and estado = 'aberta';
  return jsonb_build_object('ok', true, 'texto', v_texto);
end $$;

create or replace function mayara.listar_propostas_abertas()
returns text language plpgsql stable set search_path = '' as $$
declare v text;
begin
  select string_agg('#' || id::text || ' ' || coalesce(nome, 'Sem nome') || ' (final ' || right(telefone_chave, 4) || ')', E'\n' order by criado_em, id)
    into v from mayara.propostas_abordagem where estado = 'aberta';
  return coalesce('Propostas abertas:' || E'\n' || v, 'Não há propostas de abordagem abertas.');
end $$;

create or replace function mayara.proposta_sem_numero()
returns jsonb language plpgsql set search_path = '' as $$
declare v_qtd int; v_id bigint; v_bloq boolean;
begin
  perform mayara.expirar_propostas();
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  select count(*), max(id) into v_qtd, v_id from mayara.propostas_abordagem where estado = 'aberta';
  v_bloq := exists (select 1 from mayara.instrucoes where estado = 'pendente')
         or exists (select 1 from mayara.acoes_pendentes where estado = 'pendente');
  return jsonb_build_object('qtd', v_qtd, 'bloqueada', v_bloq,
                            'id', case when v_qtd = 1 and not v_bloq then v_id else null end);
end $$;

revoke all on function mayara.aprovar_proposta(bigint, text) from public, anon, authenticated;
revoke all on function mayara.confirmar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.descartar_proposta(bigint) from public, anon, authenticated;
revoke all on function mayara.editar_proposta(bigint, text) from public, anon, authenticated;
revoke all on function mayara.listar_propostas_abertas() from public, anon, authenticated;
revoke all on function mayara.proposta_sem_numero() from public, anon, authenticated;
