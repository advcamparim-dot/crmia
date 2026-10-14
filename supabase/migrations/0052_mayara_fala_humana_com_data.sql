-- supabase/migrations/0052_mayara_fala_humana_com_data.sql
-- A memoria do agente e lida por id; uma fala humana recuperada depois entra no fim.
-- O texto passa a carregar a data e a hora da fala para a Mayara situar a mensagem no tempo.
create or replace function mayara.registrar_mensagem_humana(p_telefone text, p_texto text, p_quando timestamptz)
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sid text; v_texto text := btrim(coalesce(p_texto, ''));
        v_quando timestamptz := least(coalesce(p_quando, now()), now());
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
            'content', 'Mensagem enviada por uma pessoa do escritório em '
                       || to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ': ' || left(v_texto, 1500),
            'tool_calls', '[]'::jsonb, 'additional_kwargs', '{}'::jsonb,
            'response_metadata', '{}'::jsonb, 'invalid_tool_calls', '[]'::jsonb),
          v_quando);
  return true;
end $$;
revoke all on function mayara.registrar_mensagem_humana(text, text, timestamptz) from public, anon, authenticated;
