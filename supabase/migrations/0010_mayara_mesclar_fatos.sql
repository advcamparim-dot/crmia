-- supabase/migrations/0010_mayara_mesclar_fatos.sql
-- O tool "Salvar Estado da Conversa" faz upsert e SOBRESCREVE fatos_json com o que o modelo mandar:
-- se o modelo omitir um fato ja gravado, ele some. Este gatilho mescla (jsonb ||) o valor novo
-- sobre o antigo, para qualquer escritor. Chaves novas ou alteradas vencem; chaves omitidas ficam.
--
-- Regras:
--   * valor novo nulo ou que nao seja objeto JSON: ignorado (mantem o antigo).
--   * valor novo com a chave "__substituir": substitui tudo pelo conteudo (sem a chave), saida
--     explicita para quem realmente precisa limpar ou reiniciar os fatos.
--   * demais casos: antigo || novo (mescla rasa: um objeto aninhado enviado substitui o aninhado antigo).

create or replace function mayara.mesclar_fatos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fatos_json is null or jsonb_typeof(new.fatos_json) <> 'object' then
    new.fatos_json := coalesce(old.fatos_json, '{}'::jsonb);
  elsif new.fatos_json ? '__substituir' then
    new.fatos_json := new.fatos_json - '__substituir';
  else
    new.fatos_json := coalesce(old.fatos_json, '{}'::jsonb) || new.fatos_json;
  end if;
  return new;
end $$;

create or replace trigger session_state_mesclar_fatos
  before update of fatos_json on mayara.session_state
  for each row
  when (new.fatos_json is distinct from old.fatos_json)
  execute function mayara.mesclar_fatos();
