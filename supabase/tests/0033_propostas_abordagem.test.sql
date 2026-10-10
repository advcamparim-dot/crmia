-- supabase/tests/0033_propostas_abordagem.test.sql
begin;
do $t$
declare r jsonb; v_id bigint;
begin
  assert (select valor from mayara.config where chave = 'abordagem_assistida') = 'false', 'chave nasce desligada';

  -- caminho feliz
  r := mayara.criar_proposta('+5511999990801', 'Ana Teste', 'crm-t1', 'Boa tarde, Ana. Aqui é a Mayara. Qual banco?', '{"valorAproximado":"100 mil"}'::jsonb, 'banco(s) envolvido(s) na dívida');
  assert (r ->> 'ok') = 'true', 'cria: ' || r::text;
  v_id := (r ->> 'id')::bigint;
  assert (select estado from mayara.propostas_abordagem where id = v_id) = 'aberta', 'nasce aberta';
  assert (select expira_em from mayara.propostas_abordagem where id = v_id) > now() + interval '23 hours', 'validade de 24 h';
  assert (select telefone_chave from mayara.propostas_abordagem where id = v_id) = mayara.chave_telefone('+5511999990801'), 'guarda a chave do telefone';
  assert (select fatos ->> 'valorAproximado' from mayara.propostas_abordagem where id = v_id) = '100 mil', 'guarda os fatos';
  assert (select lacuna from mayara.propostas_abordagem where id = v_id) like 'banco%', 'guarda a lacuna';

  -- uma so aberta por telefone (mesmo com formatos diferentes)
  r := mayara.criar_proposta('5511999990801', 'Ana Teste', 'crm-t1', 'Outro texto', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'ja_abordado', 'segunda proposta recusada: ' || r::text;
  assert (select count(*) from mayara.propostas_abordagem where telefone_chave = mayara.chave_telefone('+5511999990801')) = 1, 'so uma gravada';

  -- indice unico protege contra corrida (insercao direta)
  begin
    insert into mayara.propostas_abordagem (telefone, telefone_chave, nome, texto, estado)
    values ('+5511999990801', mayara.chave_telefone('+5511999990801'), 'Ana Teste', 'x', 'aberta');
    assert false, 'indice unico deveria barrar';
  exception when unique_violation then null;
  end;

  -- entradas invalidas
  r := mayara.criar_proposta('123', 'X Teste', null, 'texto', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'telefone_invalido', 'telefone invalido: ' || r::text;
  r := mayara.criar_proposta('+5511999990802', 'X Teste', null, '   ', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_vazio', 'texto vazio: ' || r::text;
  r := mayara.criar_proposta('+5511999990802', 'X Teste', null, repeat('x', 701), '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'texto_longo', 'texto longo: ' || r::text;

  -- lead que pediu para parar ou foi assumido nao recebe proposta
  insert into mayara.leads_autorizados (telefone, nome, status) values ('+5511999990803', 'Parou Teste', 'sem_interesse'), ('+5511999990804', 'Assumido Teste', 'bloqueado');
  r := mayara.criar_proposta('+5511999990803', 'Parou Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_inativo', 'sem_interesse: ' || r::text;
  r := mayara.criar_proposta('+5511999990804', 'Assumido Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'lead_inativo', 'bloqueado: ' || r::text;

  -- conversa recente (lead escreveu nas ultimas 48 h)
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at)
    values ('whatsapp:escritorio:+5511999990805', '+5511999990805', 'S2_QUALIFICACAO', now() - interval '3 hours');
  r := mayara.criar_proposta('+5511999990805', 'Conversa Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'conversa_recente', 'conversa recente: ' || r::text;

  -- ja abordado antes (janela de abordagem aberta)
  insert into mayara.leads_autorizados (telefone, nome, status, abordagem_ate) values ('+5511999990806', 'Abordado Teste', 'ativo', now() + interval '10 hours');
  r := mayara.criar_proposta('+5511999990806', 'Abordado Teste', null, 'Oi', '{}'::jsonb, null);
  assert (r ->> 'motivo') = 'ja_abordado', 'abordagem ja liberada: ' || r::text;

  -- acesso fechado
  assert not has_function_privilege('anon', 'mayara.criar_proposta(text,text,text,text,jsonb,text)', 'execute'), 'anon sem execute';
  assert not has_function_privilege('authenticated', 'mayara.criar_proposta(text,text,text,text,jsonb,text)', 'execute'), 'authenticated sem execute';
  assert not has_table_privilege('anon', 'mayara.propostas_abordagem', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'mayara.propostas_abordagem', 'select'), 'authenticated sem select';
end $t$;
rollback;
select 'OK 0033' as resultado;
