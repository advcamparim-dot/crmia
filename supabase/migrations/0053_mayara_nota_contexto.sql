-- supabase/migrations/0053_mayara_nota_contexto.sql
-- Nota interna na memoria da Mayara com o que aconteceu na conversa enquanto ela estava fora do ar.
create or replace function mayara.registrar_nota_contexto(p_telefone text, p_nota text)
returns boolean language plpgsql set search_path = '' as $$
declare v_chave text := mayara.chave_telefone(p_telefone); v_sid text; v_nota text := btrim(coalesce(p_nota, ''));
begin
  if v_chave is null or v_nota = '' then
    return false;
  end if;
  v_sid := mayara.sessao_do_lead(p_telefone, null);
  if v_sid is null then
    select 'whatsapp:escritorio:' || la.telefone into v_sid from mayara.leads_autorizados la where la.telefone_chave = v_chave;
  end if;
  if v_sid is null then
    return false;
  end if;
  insert into public.n8n_chat_histories (session_id, message)
  values (v_sid, jsonb_build_object('type', 'ai', 'content', left(v_nota, 4000),
            'tool_calls', '[]'::jsonb, 'additional_kwargs', '{}'::jsonb,
            'response_metadata', '{}'::jsonb, 'invalid_tool_calls', '[]'::jsonb));
  return true;
end $$;
revoke all on function mayara.registrar_nota_contexto(text, text) from public, anon, authenticated;
