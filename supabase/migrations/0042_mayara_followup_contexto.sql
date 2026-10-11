-- Contexto da conversa para gerar o follow-up e memoria da Mayara depois do envio.
create or replace function mayara.contexto_followup(p_log_id bigint)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  f mayara.followups_log%rowtype;
  v_nome text; v_tel text; v_msgs jsonb; v_fatos jsonb; v_ant jsonb; v_total int;
begin
  select * into f from mayara.followups_log where id = p_log_id;
  if not found then
    return '{}'::jsonb;
  end if;
  select la.nome, la.telefone into v_nome, v_tel from mayara.leads_autorizados la where la.telefone_chave = f.chave;
  select coalesce(jsonb_agg(jsonb_build_object('papel', case when m.tipo = 'human' then 'lead' else 'mayara' end, 'texto', m.texto) order by m.criado), '[]'::jsonb)
    into v_msgs
    from (select h.message ->> 'type' as tipo, left(coalesce(h.message ->> 'content', ''), 500) as texto, h.created_at as criado
            from public.n8n_chat_histories h
           where mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = f.chave
             and h.message ->> 'type' in ('human', 'ai')
           order by h.created_at desc limit 8) m;
  select coalesce((select s.fatos_json from mayara.session_state s where mayara.chave_telefone(s.phone) = f.chave
                    order by s.updated_at desc limit 1), '{}'::jsonb) into v_fatos;
  select coalesce(jsonb_agg(a.texto order by a.criado_em), '[]'::jsonb) into v_ant
    from (select l.texto, l.criado_em from mayara.followups_log l
           where l.chave = f.chave and l.estado in ('enviado', 'simulado') and l.texto is not null
           order by l.criado_em desc limit 5) a;
  select coalesce(fe.enviados_total, 0) into v_total from (select 1) x left join mayara.followup_estado fe on fe.chave = f.chave;
  return jsonb_build_object('nome', v_nome, 'telefone', v_tel, 'mensagens', v_msgs, 'fatos', v_fatos,
                            'anteriores', v_ant, 'tentativa', coalesce(v_total, 0) + 1);
end $$;

create or replace function mayara.registrar_followup(p_log_id bigint, p_estado text, p_texto text, p_fonte text, p_motivo text)
returns void language plpgsql set search_path = '' as $$
declare f mayara.followups_log%rowtype; v_sid text; v_tel text;
begin
  if p_estado not in ('enviado', 'simulado', 'cancelado', 'falhou') then
    raise exception 'estado invalido: %', p_estado;
  end if;
  update mayara.followups_log
     set estado = p_estado, texto = p_texto, fonte = p_fonte, motivo = left(p_motivo, 300), atualizado_em = now()
   where id = p_log_id and estado = 'reservado'
  returning * into f;
  if not found then
    return;
  end if;
  if p_estado in ('enviado', 'simulado') then
    insert into mayara.followup_estado (chave, ciclo_saida, etapa_atual, enviados_total, ultimo_envio_em)
    values (f.chave, f.ciclo_saida, f.etapa, case when p_estado = 'enviado' then 1 else 0 end, now())
    on conflict (chave) do update
       set ciclo_saida = excluded.ciclo_saida,
           etapa_atual = excluded.etapa_atual,
           enviados_total = mayara.followup_estado.enviados_total + case when p_estado = 'enviado' then 1 else 0 end,
           ultimo_envio_em = excluded.ultimo_envio_em,
           texto_proximo = null,
           atualizado_em = now();
  end if;
  if p_estado = 'enviado' and coalesce(p_texto, '') <> '' then
    -- a Mayara precisa lembrar do que disse quando o lead responder: grava na sessao em que o lead conversa
    select h.session_id into v_sid from public.n8n_chat_histories h
     where h.message ->> 'type' = 'human' and mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = f.chave
     order by h.created_at desc limit 1;
    if v_sid is null then
      select s.session_key into v_sid from mayara.session_state s
       where mayara.chave_telefone(s.phone) = f.chave order by s.updated_at desc limit 1;
    end if;
    if v_sid is null then
      select 'whatsapp:escritorio:' || la.telefone into v_sid from mayara.leads_autorizados la where la.telefone_chave = f.chave;
    end if;
    if v_sid is not null then
      insert into public.n8n_chat_histories (session_id, message, created_at)
      values (v_sid, jsonb_build_object('type', 'ai', 'content', p_texto, 'tool_calls', '[]'::jsonb,
                                        'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb,
                                        'invalid_tool_calls', '[]'::jsonb), now());
    end if;
  end if;
end $$;

revoke all on function mayara.contexto_followup(bigint) from public, anon, authenticated;
revoke all on function mayara.registrar_followup(bigint, text, text, text, text) from public, anon, authenticated;
