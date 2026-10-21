-- Preserva a regua depois de abordagem automatica e grava a confirmacao
-- na sessao canonica do lead. A selecao da abordagem automatica nao muda.

create or replace function mayara._ultima_saida(p_chave text)
returns timestamptz language sql stable set search_path = '' as $$
  select max(l.criado_em) from mayara.envios_log l
   where l.destino_chave = p_chave
     and l.ok
     and l.origem in ('ponte', 'abordagem_assistida', 'abordagem_automatica', 'reativacao')
$$;

create or replace function mayara.confirmar_envio_proposta(p_id bigint, p_ok boolean, p_erro text)
returns text language plpgsql set search_path = '' as $$
declare
  p mayara.propostas_abordagem%rowtype;
  v_sessao text;
begin
  select * into p from mayara.propostas_abordagem where id = p_id for update;
  if not found then
    return 'Proposta não encontrada.';
  end if;
  if p.estado <> 'aprovada' then
    return 'Nada a confirmar: a proposta está ' || p.estado || '.';
  end if;
  if p_ok then
    v_sessao := mayara.sessao_do_lead(p.telefone, 'whatsapp:escritorio:' || p.telefone);
    update mayara.propostas_abordagem set estado = 'enviada', encerrada_em = now() where id = p.id;
    insert into public.n8n_chat_histories (session_id, message, created_at)
    values (v_sessao,
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

revoke all on function mayara._ultima_saida(text) from public, anon, authenticated;
revoke all on function mayara.confirmar_envio_proposta(bigint, boolean, text) from public, anon, authenticated;
