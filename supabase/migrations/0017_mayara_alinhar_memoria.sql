-- supabase/migrations/0017_mayara_alinhar_memoria.sql
-- A memoria de conversa (public.n8n_chat_histories) guarda a resposta ORIGINAL do modelo. Quando o
-- guardrail troca a resposta antes do envio, a memoria passa a divergir do que o lead recebeu.
-- Toda resposta final e gravada em mayara.bridge_responses; este gatilho alinha, nesse momento, a
-- ultima resposta do assistente na memoria com o texto realmente enviado.
-- Falha aberta: qualquer erro aqui nunca impede a gravacao da resposta.

create or replace function mayara.alinhar_memoria_com_resposta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.output is null or new.session_key is null then
    return new;
  end if;
  begin
    update public.n8n_chat_histories
    set message = jsonb_set(message, '{content}', to_jsonb(new.output))
    where id = (
      select id from public.n8n_chat_histories
      where session_id = new.session_key
        and message ->> 'type' = 'ai'
        and message ->> 'content' not like 'Calling %'
      order by id desc limit 1)
    and message ->> 'content' is distinct from new.output;
  exception when others then
    null;
  end;
  return new;
end $$;

create or replace trigger bridge_responses_alinhar_memoria
  after insert or update of output on mayara.bridge_responses
  for each row execute function mayara.alinhar_memoria_com_resposta();

revoke all on function mayara.alinhar_memoria_com_resposta() from public, anon, authenticated;
