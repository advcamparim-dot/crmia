-- supabase/tests/0024_abordagem_lead.test.sql
-- Rodar inteiro (execute_sql). Dados ficticios; termina em rollback.
begin;
-- janela de 48 h ligada para este teste (a janela pode estar desligada com evolution_janela_horas = 0)
update mayara.config set valor = '48' where chave = 'evolution_janela_horas';

do $t$
declare r jsonb;
begin
  -- autorizar a abordagem cria o lead ativo, liga ao lead do CRM e abre a janela de envio
  r := mayara.autorizar_abordagem('+5511999990601', 'Fulano Teste', 'crm-1', 24);
  assert (r ->> 'status') = 'ativo' and (r ->> 'abordagem_liberada') = 'true', 'autoriza: ' || r::text;
  assert (select espocrm_lead_id from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990601')) = 'crm-1', 'liga ao CRM';

  -- lead sem conversa recente passa a poder receber a primeira mensagem
  r := mayara.pode_enviar('escritorio', '5511999990601', 'texto');
  assert (r ->> 'ok') = 'true', 'abordagem libera o envio: ' || r::text;

  -- janela vencida volta a bloquear
  update mayara.leads_autorizados set abordagem_ate = now() - interval '1 minute' where telefone_chave = mayara.chave_telefone('+5511999990601');
  r := mayara.pode_enviar('escritorio', '5511999990601', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'janela vencida bloqueia: ' || r::text;

  -- lead bloqueado (equipe assumiu) nao recebe, mesmo com janela aberta
  update mayara.leads_autorizados set abordagem_ate = now() + interval '1 hour', status = 'bloqueado' where telefone_chave = mayara.chave_telefone('+5511999990601');
  r := mayara.pode_enviar('escritorio', '5511999990601', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'bloqueado nao envia: ' || r::text;

  -- quem pediu para parar (sem_interesse) nunca e reaberto pela abordagem
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990602', 'Sem Interesse', 'sem_interesse');
  r := mayara.autorizar_abordagem('+5511999990602', 'Sem Interesse', 'crm-2', 24);
  assert (r ->> 'status') = 'sem_interesse' and (r ->> 'abordagem_liberada') = 'false', 'respeita sem_interesse: ' || r::text;
  assert (select abordagem_ate from mayara.leads_autorizados where telefone_chave = mayara.chave_telefone('+5511999990602')) is null, 'nao abre janela';
  r := mayara.pode_enviar('escritorio', '5511999990602', 'texto');
  assert (r ->> 'motivo') = 'fora_da_janela', 'sem_interesse nao envia: ' || r::text;

  -- sessao de reativacao com o historico anterior
  perform mayara.iniciar_sessao_reativacao('whatsapp:escritorio:+5511999990601', '+5511999990601', '{"nomeCompleto":"Fulano Teste","historicoAnterior":"5 contatos sem resposta"}'::jsonb);
  assert (select estado from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990601') = 'S1_ENGAJADO', 'estado engajado';
  assert (select fatos_json ->> 'historicoAnterior' from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990601') = '5 contatos sem resposta', 'guarda o historico';
  assert (select phone_number_id from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990601') = 'escritorio', 'canal da sessao';

  -- repetir nao zera o que ja existe nos fatos
  perform mayara.iniciar_sessao_reativacao('whatsapp:escritorio:+5511999990601', '+5511999990601', '{"tipoDivida":"Outros"}'::jsonb);
  assert (select fatos_json ->> 'historicoAnterior' from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990601') = '5 contatos sem resposta', 'mantem fatos anteriores';
  assert (select fatos_json ->> 'tipoDivida' from mayara.session_state where session_key = 'whatsapp:escritorio:+5511999990601') = 'Outros', 'acrescenta fatos novos';

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.autorizar_abordagem(text,text,text,int)', 'execute'), 'anon sem execute (autorizar)';
  assert not has_function_privilege('authenticated', 'mayara.autorizar_abordagem(text,text,text,int)', 'execute'), 'authenticated sem execute (autorizar)';
  assert not has_function_privilege('anon', 'mayara.iniciar_sessao_reativacao(text,text,jsonb)', 'execute'), 'anon sem execute (sessao)';
end $t$;

rollback;
select 'OK 0024' as resultado;
