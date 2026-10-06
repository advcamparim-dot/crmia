-- supabase/tests/0016_humano_assumiu.test.sql
-- Rodar inteiro (execute_sql). Numeros ficticios; termina em rollback.
begin;

select mayara.upsert_lead_autorizado('+5511999990701', 'Lead Ativo', 't1@example.com', 'Empresa', 'teste', 'x', '{}'::jsonb);
select mayara.upsert_lead_autorizado('+5511999990702', 'Lead Bloqueado', 't2@example.com', 'Empresa', 'teste', 'x', '{}'::jsonb);
update mayara.leads_autorizados set status = 'bloqueado' where telefone_chave = mayara.chave_telefone('+5511999990702');
select mayara.upsert_lead_autorizado('+5511999990703', 'Lead Sem Interesse', 't3@example.com', 'Empresa', 'teste', 'x', '{}'::jsonb);
update mayara.leads_autorizados set status = 'sem_interesse' where telefone_chave = mayara.chave_telefone('+5511999990703');
insert into mayara.session_state (session_key, phone, estado) values
  ('whatsapp:t-humano:+5511999990701', '+5511999990701', 'S2_QUALIFICACAO'),
  ('whatsapp:t-humano:+5511999990702', '+5511999990702', 'S7_HANDOFF_HUMANO');

do $t$
declare r jsonb;
begin
  -- 1. mensagem que a propria Mayara enviou (id no log de envios): nao pausa ninguem
  perform mayara.registrar_envio('t-humano', '5511999990701', 'texto', '{"ok":true,"messages":[{"id":"3EBMAYARA1"}]}'::jsonb);
  r := mayara.humano_assumiu('t-humano', '+5511999990701', '3EBMAYARA1');
  assert (r ->> 'acao') = 'mayara', 'mensagem da Mayara: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990701')) = 'ativo', 'lead segue ativo';

  -- 2. humano respondeu a um lead ativo: assume
  r := mayara.humano_assumiu('t-humano', '+5511999990701', 'HUMANO1');
  assert (r ->> 'acao') = 'assumido', 'humano assume: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990701')) = 'bloqueado', 'lead bloqueado';
  assert (select estado from mayara.session_state where session_key = 'whatsapp:t-humano:+5511999990701') = 'S7_HANDOFF_HUMANO', 'sessao em handoff';

  -- 3. mensagem repetida do humano: ja esta assumido, nao muda nada
  r := mayara.humano_assumiu('t-humano', '+5511999990701', 'HUMANO2');
  assert (r ->> 'acao') = 'ignorado' and (r ->> 'status') = 'bloqueado', 'repeticao: ' || r::text;

  -- 4. lead ja bloqueado ou sem interesse: ignora, sem reativar nem alterar
  r := mayara.humano_assumiu('t-humano', '+5511999990702', 'HUMANO3');
  assert (r ->> 'acao') = 'ignorado', 'ja bloqueado: ' || r::text;
  r := mayara.humano_assumiu('t-humano', '+5511999990703', 'HUMANO4');
  assert (r ->> 'acao') = 'ignorado' and (r ->> 'status') = 'sem_interesse', 'sem interesse: ' || r::text;
  assert (select status from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990703')) = 'sem_interesse', 'sem interesse intacto';

  -- 5. numero que nao e lead (cliente real, nao cadastrado): nao cria nada
  r := mayara.humano_assumiu('t-humano', '+5511999990799', 'HUMANO5');
  assert (r ->> 'acao') = 'ignorado' and (r ->> 'status') is null, 'nao e lead: ' || r::text;
  assert not exists (select 1 from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990799')), 'nao cadastra';

  -- 6. telefone invalido
  r := mayara.humano_assumiu('t-humano', '123', 'HUMANO6');
  assert (r ->> 'acao') = 'telefone_invalido', 'telefone invalido: ' || r::text;

  -- 7. todo caso fica registrado em canal_eventos, sem texto
  assert (select count(*) from mayara.canal_eventos where canal_id = 't-humano' and motivo = 'humano_assumiu') = 1, 'um assumiu';
  assert (select count(*) from mayara.canal_eventos where canal_id = 't-humano' and motivo = 'enviada_por_mim') = 1, 'uma da Mayara';
  assert (select count(*) from mayara.canal_eventos where canal_id = 't-humano') = 7, 'sete eventos';

  -- 8. acesso fechado
  assert not has_function_privilege('anon', 'mayara.humano_assumiu(text,text,text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.humano_assumiu(text,text,text)', 'execute'), 'authenticated sem execute';
end $t$;

rollback;
select 'OK 0016' as resultado;
