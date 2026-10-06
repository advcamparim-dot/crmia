-- supabase/tests/0010_mesclar_fatos.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;

insert into mayara.session_state (session_key, phone, estado, fatos_json)
values ('t-mesclar', '+5511999990601', 'S1_ENGAJADO',
        '{"nomeCompleto":"Ana","tipoDivida":"bancaria","valorAproximado":"50 mil","detalhe":{"a":1,"b":2}}'::jsonb);

do $t$
declare f jsonb;
begin
  -- 1. campo omitido continua guardado; campo novo entra
  update mayara.session_state set fatos_json = '{"email":"ana@example.com"}'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f ->> 'nomeCompleto' = 'Ana' and f ->> 'tipoDivida' = 'bancaria', 'omitidos permanecem: ' || f::text;
  assert f ->> 'email' = 'ana@example.com', 'novo entra: ' || f::text;

  -- 2. campo alterado vence
  update mayara.session_state set fatos_json = '{"valorAproximado":"80 mil"}'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f ->> 'valorAproximado' = '80 mil' and f ->> 'nomeCompleto' = 'Ana', 'alterado vence: ' || f::text;

  -- 3. objeto aninhado enviado substitui o aninhado (mescla rasa)
  update mayara.session_state set fatos_json = '{"detalhe":{"c":3}}'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f -> 'detalhe' = '{"c":3}'::jsonb, 'mescla rasa: ' || f::text;

  -- 4. nulo, array e texto sao ignorados
  update mayara.session_state set fatos_json = null where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f ->> 'nomeCompleto' = 'Ana', 'nulo ignorado: ' || f::text;
  update mayara.session_state set fatos_json = '[1,2]'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert jsonb_typeof(f) = 'object' and f ->> 'nomeCompleto' = 'Ana', 'array ignorado: ' || f::text;
  update mayara.session_state set fatos_json = '"texto"'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert jsonb_typeof(f) = 'object' and f ->> 'nomeCompleto' = 'Ana', 'texto ignorado: ' || f::text;

  -- 5. __substituir limpa e reinicia, e a chave nao fica gravada
  update mayara.session_state set fatos_json = '{"__substituir":true,"nomeCompleto":"Bia"}'::jsonb where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f = '{"nomeCompleto":"Bia"}'::jsonb, 'substituir: ' || f::text;

  -- 6. outra coluna atualizada nao toca nos fatos
  update mayara.session_state set estado = 'S2_QUALIFICADO' where session_key = 't-mesclar';
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f = '{"nomeCompleto":"Bia"}'::jsonb, 'outra coluna: ' || f::text;

  -- 7. insert com conflito (upsert) tambem mescla
  insert into mayara.session_state (session_key, phone, estado, fatos_json)
  values ('t-mesclar', '+5511999990601', 'S2_QUALIFICADO', '{"email":"bia@example.com"}'::jsonb)
  on conflict (session_key) do update set fatos_json = excluded.fatos_json;
  select fatos_json into f from mayara.session_state where session_key = 't-mesclar';
  assert f ->> 'nomeCompleto' = 'Bia' and f ->> 'email' = 'bia@example.com', 'upsert mescla: ' || f::text;
end $t$;

rollback;
select 'OK 0010' as resultado;
