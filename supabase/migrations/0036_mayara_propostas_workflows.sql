-- supabase/migrations/0036_mayara_propostas_workflows.sql
create or replace function mayara.contexto_central(p_telefone text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_prop jsonb;
begin
  perform mayara.expirar_pendentes();
  perform mayara.expirar_acoes_pendentes();
  v_prop := mayara.proposta_sem_numero();
  return jsonb_build_object(
    'pendente', exists (select 1 from mayara.instrucoes where estado = 'pendente'),
    'acao_pendente', exists (select 1 from mayara.acoes_pendentes where estado = 'pendente'),
    'exclusivo', coalesce((select valor from mayara.config where chave = 'canal_comando_exclusivo'), 'false') = 'true',
    'propostas_abertas', (v_prop ->> 'qtd')::int,
    'proposta_unica', v_prop -> 'id'
  );
end $$;

create or replace function mayara._motivo_proposta(p_motivo text, p_id bigint)
returns text language sql immutable set search_path = '' as $$
  select case p_motivo
    when 'nao_encontrada' then 'Não achei a proposta ' || p_id::text || '.'
    when 'ja_aprovada' then 'A proposta ' || p_id::text || ' já foi aprovada.'
    when 'expirada' then 'A proposta ' || p_id::text || ' expirou. O lead segue no CRM para contato manual.'
    when 'nao_esta_aberta' then 'A proposta ' || p_id::text || ' não está aberta.'
    when 'lead_inativo' then 'Não enviei: esse lead pediu para parar ou já foi assumido pela equipe. Descartei a proposta ' || p_id::text || '.'
    when 'texto_vazio' then 'Escreva o novo texto depois dos dois pontos. Exemplo: editar ' || p_id::text || ': Boa tarde, ...'
    when 'texto_longo' then 'O texto ficou longo demais (máximo 700 caracteres).'
    when 'texto_invalido' then 'O texto não pode ter link. Envie de novo sem link.'
    else 'Não consegui processar a proposta ' || p_id::text || '.'
  end
$$;

create or replace function mayara.decidir_proposta(p_op text, p_id bigint, p_texto text, p_autor text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  if p_op = 'listar' then
    return jsonb_build_object('acao', 'responder', 'resposta', mayara.listar_propostas_abertas());
  end if;
  if p_op not in ('aprovar', 'descartar', 'editar') then
    return jsonb_build_object('acao', 'responder', 'resposta', 'Não entendi o que fazer com a proposta.');
  end if;
  if p_id is null then
    return jsonb_build_object('acao', 'responder', 'resposta', 'Informe o número da proposta, por exemplo: sim 12.');
  end if;
  if p_op = 'descartar' then
    return jsonb_build_object('acao', 'responder', 'resposta', mayara.descartar_proposta(p_id));
  end if;
  if p_op = 'editar' then
    r := mayara.editar_proposta(p_id, p_texto);
    if (r ->> 'ok') = 'true' then
      return jsonb_build_object('acao', 'responder', 'resposta',
        'Texto atualizado na proposta ' || p_id::text || E':\n\n' || (r ->> 'texto')
        || E'\n\nResponda *sim ' || p_id::text || '* para enviar ou *não ' || p_id::text || '* para descartar.');
    end if;
    return jsonb_build_object('acao', 'responder', 'resposta', mayara._motivo_proposta(r ->> 'motivo', p_id));
  end if;
  r := mayara.aprovar_proposta(p_id, p_autor);
  if (r ->> 'ok') = 'true' then
    return jsonb_build_object('acao', 'enviar', 'id', p_id, 'destino', r ->> 'destino', 'texto', r ->> 'texto',
                              'nome', r ->> 'nome', 'crm_lead_id', r ->> 'crm_lead_id');
  end if;
  return jsonb_build_object('acao', 'responder', 'resposta', mayara._motivo_proposta(r ->> 'motivo', p_id));
end $$;

create or replace function mayara.finalizar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare p mayara.propostas_abordagem%rowtype;
begin
  select * into p from mayara.propostas_abordagem where id = p_id;
  if not found then
    return 'Proposta não encontrada.';
  end if;
  perform mayara.confirmar_envio_proposta(p_id, p_ok, p_erro);
  if p_ok then
    return 'Enviei a mensagem para ' || coalesce(p.nome, 'o lead') || ' (final ' || right(p.telefone_chave, 4)
           || '). Quando responder, a Mayara atende a conversa.';
  end if;
  return 'Não consegui enviar para ' || coalesce(p.nome, 'o lead') || ' (final ' || right(p.telefone_chave, 4)
         || '): ' || left(coalesce(p_erro, 'erro desconhecido'), 120)
         || '. A proposta foi encerrada como falhou; envie manualmente.';
end $$;

create or replace function mayara.liberar_notificacao(p_id bigint, p_tipo text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_tipo = 'nova' then
    update mayara.propostas_abordagem set notificada_em = null where id = p_id and estado = 'aberta';
  elsif p_tipo = 'lembrete' then
    update mayara.propostas_abordagem set lembrete_em = null where id = p_id and estado = 'aberta';
  end if;
end $$;

revoke all on function mayara._motivo_proposta(text, bigint) from public, anon, authenticated;
revoke all on function mayara.decidir_proposta(text, bigint, text, text) from public, anon, authenticated;
revoke all on function mayara.finalizar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
revoke all on function mayara.liberar_notificacao(bigint, text) from public, anon, authenticated;
revoke all on function mayara.contexto_central(text) from public, anon, authenticated;
