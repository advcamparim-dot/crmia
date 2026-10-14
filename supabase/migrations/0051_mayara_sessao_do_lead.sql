-- supabase/migrations/0051_mayara_sessao_do_lead.sql
-- Uma sessao (memoria) por lead, mesmo quando o WhatsApp entrega o numero sem o nono digito
-- e o CRM/abordagem usam o numero com o nono digito.
alter table mayara.session_state
  add column if not exists unida_em timestamptz,
  add column if not exists unida_para text;


-- Registro do que foi movido na uniao, para permitir desfazer.
create table if not exists mayara.sessoes_unidas_log (
  id bigserial primary key,
  historico_id bigint not null,
  session_origem text not null,
  session_destino text not null,
  unida_em timestamptz not null default now()
);
alter table mayara.sessoes_unidas_log enable row level security;
revoke all on mayara.sessoes_unidas_log from anon, authenticated;

create or replace function mayara._chave_da_sessao(p_phone text, p_session_key text)
returns text language sql stable set search_path = '' as $$
  select mayara.chave_telefone(coalesce(nullif(p_phone, ''), substring(p_session_key from '[+0-9]+$')))
$$;

-- Sessao canonica do lead: a que tem mais historico (desempate: a mais antiga), incluindo sessoes so de historico.
-- Sem sessao, devolve p_session_key.
create or replace function mayara.sessao_do_lead(p_telefone text, p_session_key text default null)
returns text language plpgsql stable set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sk text;
begin
  if v_chave is null then
    return p_session_key;
  end if;
  with cand as (
    select s.session_key as sk, s.created_at as criada
      from mayara.session_state s
     where s.unida_em is null and mayara._chave_da_sessao(s.phone, s.session_key) = v_chave
    union
    select h.session_id, min(h.created_at)
      from public.n8n_chat_histories h
     where h.session_id like '%' || right(v_chave, 8)
       and mayara.chave_telefone(substring(h.session_id from '[+0-9]+$')) = v_chave
       and not exists (select 1 from mayara.session_state u where u.session_key = h.session_id)
     group by h.session_id
  )
  select c.sk into v_sk from cand c
   order by (select count(*) from public.n8n_chat_histories h where h.session_id = c.sk) desc, c.criada asc, c.sk
   limit 1;
  return coalesce(v_sk, p_session_key);
end $$;

create or replace function mayara.com_sessao_canonica(p_evento jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_sk text;
begin
  if p_evento is null or jsonb_typeof(p_evento) <> 'object' or coalesce(p_evento ->> 'phone', '') = '' then
    return p_evento;
  end if;
  v_sk := mayara.sessao_do_lead(p_evento ->> 'phone', p_evento ->> 'sessionKey');
  if v_sk is null then
    return p_evento;
  end if;
  return p_evento || jsonb_build_object('sessionKey', v_sk);
end $$;

create or replace function mayara.iniciar_sessao_reativacao(p_session_key text, p_phone text, p_fatos jsonb)
returns void language plpgsql set search_path = '' as $$
declare v_key text := coalesce(mayara.sessao_do_lead(p_phone, p_session_key), p_session_key);
begin
  insert into mayara.session_state (session_key, phone, phone_number_id, estado, fatos_json, last_lead_message_at)
  values (v_key, p_phone, nullif(split_part(v_key, ':', 2), ''), 'S1_ENGAJADO', coalesce(p_fatos, '{}'::jsonb), now())
  on conflict (session_key) do update set
    fatos_json = mayara.session_state.fatos_json || coalesce(p_fatos, '{}'::jsonb),
    phone = coalesce(mayara.session_state.phone, excluded.phone),
    phone_number_id = coalesce(mayara.session_state.phone_number_id, excluded.phone_number_id);
end $$;

create or replace function mayara.registrar_mensagem_humana(p_telefone text, p_texto text, p_quando timestamptz)
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sid text; v_texto text := btrim(coalesce(p_texto, ''));
begin
  if v_chave is null or v_texto = '' then
    return false;
  end if;
  v_sid := mayara.sessao_do_lead(p_telefone, null);
  if v_sid is null then
    select 'whatsapp:escritorio:' || la.telefone into v_sid from mayara.leads_autorizados la where la.telefone_chave = v_chave;
  end if;
  if v_sid is null then
    return false;
  end if;
  insert into public.n8n_chat_histories (session_id, message, created_at)
  values (v_sid, jsonb_build_object('type', 'ai',
            'content', 'Mensagem enviada por uma pessoa do escritório: ' || left(v_texto, 1500),
            'tool_calls', '[]'::jsonb, 'additional_kwargs', '{}'::jsonb,
            'response_metadata', '{}'::jsonb, 'invalid_tool_calls', '[]'::jsonb),
          least(coalesce(p_quando, now()), now()));
  return true;
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
    select la.telefone into v_tel from mayara.leads_autorizados la where la.telefone_chave = f.chave;
    v_sid := mayara.sessao_do_lead(v_tel, null);
    if v_sid is null and v_tel is not null then
      v_sid := 'whatsapp:escritorio:' || v_tel;
    end if;
    if v_sid is not null then
      insert into public.n8n_chat_histories (session_id, message, created_at)
      values (v_sid, jsonb_build_object('type', 'ai', 'content', p_texto, 'tool_calls', '[]'::jsonb,
                                        'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb,
                                        'invalid_tool_calls', '[]'::jsonb), now());
    end if;
  end if;
end $$;

-- Une as sessoes duplicadas de um lead (ou de todos, com p_chave nulo) na sessao canonica. Nada e apagado.
create or replace function mayara.unir_sessoes_duplicadas(p_chave text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare r record; d record; v_canon text; v_unidas int := 0; v_ult text;
begin
  for r in
    select distinct mayara._chave_da_sessao(s.phone, s.session_key) as ch
      from mayara.session_state s
     where s.unida_em is null
       and mayara._chave_da_sessao(s.phone, s.session_key) is not null
       and (p_chave is null or mayara._chave_da_sessao(s.phone, s.session_key) = p_chave)
  loop
    select s.session_key into v_canon
      from mayara.session_state s
     where s.unida_em is null and mayara._chave_da_sessao(s.phone, s.session_key) = r.ch
     order by (select count(*) from public.n8n_chat_histories h where h.session_id = s.session_key) desc, s.created_at asc, s.session_key
     limit 1;
    for d in
      select * from mayara.session_state s
       where s.unida_em is null and mayara._chave_da_sessao(s.phone, s.session_key) = r.ch and s.session_key <> v_canon
    loop
      update mayara.session_state c
         set fatos_json = d.fatos_json || c.fatos_json,
             last_lead_message_at = greatest(c.last_lead_message_at, d.last_lead_message_at),
             consulta_agendada_em = coalesce(c.consulta_agendada_em, d.consulta_agendada_em),
             updated_at = now()
       where c.session_key = v_canon;
      insert into mayara.sessoes_unidas_log (historico_id, session_origem, session_destino)
        select h.id, d.session_key, v_canon from public.n8n_chat_histories h where h.session_id = d.session_key;
      update public.n8n_chat_histories set session_id = v_canon where session_id = d.session_key;
      update mayara.session_state set unida_em = now(), unida_para = v_canon, phone = null where session_key = d.session_key;
      v_unidas := v_unidas + 1;
    end loop;
    v_ult := v_canon;
  end loop;
  return jsonb_build_object('unidas', v_unidas, 'canonica', v_ult);
end $$;

revoke all on function mayara._chave_da_sessao(text, text) from public, anon, authenticated;
revoke all on function mayara.sessao_do_lead(text, text) from public, anon, authenticated;
revoke all on function mayara.com_sessao_canonica(jsonb) from public, anon, authenticated;
revoke all on function mayara.iniciar_sessao_reativacao(text, text, jsonb) from public, anon, authenticated;
revoke all on function mayara.registrar_mensagem_humana(text, text, timestamptz) from public, anon, authenticated;
revoke all on function mayara.registrar_followup(bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function mayara.unir_sessoes_duplicadas(text) from public, anon, authenticated;
