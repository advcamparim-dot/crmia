-- supabase/tests/0008_leads_autorizados.test.sql
-- Rodar inteiro (execute_sql). Cada asserção lança exceção se falhar; termina em rollback.
begin;

do $$
begin
  -- chave: com e sem nono digito, formatada, e invalidos
  assert mayara.chave_telefone('+5514997022609') = '1497022609', 'chave com nono digito';
  assert mayara.chave_telefone('+551497022609') = '1497022609', 'chave sem nono digito';
  assert mayara.chave_telefone('+55 (14) 99702-2609') = '1497022609', 'chave formatada';
  assert mayara.chave_telefone('abc') is null, 'chave texto';
  assert mayara.chave_telefone('+14155552671') is null, 'chave estrangeiro';
  assert mayara.chave_telefone('+5514') is null, 'chave curta';
  assert mayara.chave_telefone(null) is null, 'chave nula';
end $$;

do $$
declare v text;
begin
  -- upsert cria, atualiza sem duplicar e reativa sem_interesse, mas nao bloqueado
  v := mayara.upsert_lead_autorizado('+5511999990001','Teste Um','a@b.co','Empresa X','teste','camp1','{"k":1}'::jsonb);
  assert v = 'ativo', 'novo lead ativo';
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone = '+5511999990001';
  v := mayara.upsert_lead_autorizado('+5511999990001','Teste Um','a@b.co','Empresa X','teste','camp1','{}'::jsonb);
  assert v = 'ativo', 'sem_interesse reativa';
  update mayara.leads_autorizados set status = 'bloqueado' where telefone = '+5511999990001';
  v := mayara.upsert_lead_autorizado('+5511999990001','Teste Um','a@b.co','Empresa X','teste','camp1','{}'::jsonb);
  assert v = 'bloqueado', 'bloqueado nao reativa';
  assert (select count(*) from mayara.leads_autorizados where telefone_chave = '1199990001') = 1, 'sem duplicar';
  -- mesmo numero escrito sem o nono digito cai no mesmo lead (chave unica)
  perform mayara.upsert_lead_autorizado('+551199990001','Outro Nome',null,null,'teste',null,'{}'::jsonb);
  assert (select count(*) from mayara.leads_autorizados where telefone_chave = '1199990001') = 1, 'oito digitos nao duplica';
end $$;

do $$
begin
  -- telefone fora do formato canonico e recusado
  begin
    insert into mayara.leads_autorizados (telefone) values ('11999990002');
    raise exception 'esperava violacao de check';
  exception when check_violation or not_null_violation then null;
  end;
end $$;

do $$
begin
  -- motivo_bloqueio
  perform mayara.upsert_lead_autorizado('+5511999990003','A',null,null,'teste',null,'{}'::jsonb);
  assert mayara.motivo_bloqueio('+5511999990003') is null, 'ativo liberado';
  assert mayara.motivo_bloqueio('+551199990003') is null, 'ativo liberado sem nono digito';
  assert mayara.motivo_bloqueio('+5511999990099') = 'nao_cadastrado', 'desconhecido';
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone = '+5511999990003';
  assert mayara.motivo_bloqueio('+5511999990003') = 'sem_interesse', 'sem interesse';
  update mayara.leads_autorizados set status = 'bloqueado' where telefone = '+5511999990003';
  assert mayara.motivo_bloqueio('+5511999990003') = 'bloqueado', 'bloqueado';
end $$;

do $$
begin
  -- registrar_numero_nao_cadastrado: um aviso por numero a cada 24h
  assert mayara.registrar_numero_nao_cadastrado('+5511999990004','nao_cadastrado','oi') = true, 'primeiro aviso';
  assert mayara.registrar_numero_nao_cadastrado('+5511999990004','nao_cadastrado','oi de novo') = false, 'segundo sem aviso';
  assert (select qtd_mensagens from mayara.numeros_nao_cadastrados where telefone_chave = '1199990004') = 2, 'contou 2';
  assert (select ultima_mensagem from mayara.numeros_nao_cadastrados where telefone_chave = '1199990004') = 'oi de novo', 'ultima mensagem';
  update mayara.numeros_nao_cadastrados set avisado_em = now() - interval '25 hours' where telefone_chave = '1199990004';
  assert mayara.registrar_numero_nao_cadastrado('+5511999990004','nao_cadastrado','voltei') = true, 'aviso apos 24h';
  -- remetente estrangeiro tambem e registrado (chave = digitos)
  assert mayara.registrar_numero_nao_cadastrado('+14155552671','nao_cadastrado','hi') = true, 'estrangeiro registrado';
  assert exists (select 1 from mayara.numeros_nao_cadastrados where telefone_chave = '14155552671'), 'chave estrangeira';
end $$;

do $$
begin
  -- lead_ativo_da_sessao
  perform mayara.upsert_lead_autorizado('+5511999990005','B',null,null,'teste',null,'{}'::jsonb);
  assert mayara.lead_ativo_da_sessao('whatsapp:1365007506685934:+5511999990005') = true, 'sessao ativa';
  update mayara.leads_autorizados set status = 'sem_interesse' where telefone = '+5511999990005';
  assert mayara.lead_ativo_da_sessao('whatsapp:1365007506685934:+5511999990005') = false, 'sessao sem interesse';
  assert mayara.lead_ativo_da_sessao('whatsapp:1365007506685934:+5511999990098') = false, 'sessao desconhecida';
end $$;

do $$
begin
  -- teto por hora (leads de teste nao contam)
  update mayara.config set valor = '2' where chave = 'teto_leads_por_hora';
  delete from mayara.leads_autorizados;
  assert mayara.dentro_do_teto_por_hora() = true, 'vazio dentro do teto';
  perform mayara.upsert_lead_autorizado('+5511999990010','C',null,null,'landing_campanha_pj',null,'{}'::jsonb);
  perform mayara.upsert_lead_autorizado('+5511999990011','D',null,null,'landing_campanha_pj',null,'{}'::jsonb);
  assert mayara.dentro_do_teto_por_hora() = false, 'no teto';
  perform mayara.upsert_lead_autorizado('+5511999990012','E',null,null,'teste',null,'{}'::jsonb);
  assert (select count(*) from mayara.leads_autorizados) = 3, 'lead de teste entrou';
  assert mayara.dentro_do_teto_por_hora() = false, 'teste nao conta para o teto';
end $$;

do $$
begin
  -- config inicial e RLS ligada nas quatro tabelas e em leads_rejeitados
  assert (select valor from mayara.config where chave = 'envio_template_ativo') = 'false', 'template desligado';
  assert (select relrowsecurity from pg_class where oid = 'mayara.leads_autorizados'::regclass), 'rls leads';
  assert (select relrowsecurity from pg_class where oid = 'mayara.numeros_nao_cadastrados'::regclass), 'rls numeros';
  assert (select relrowsecurity from pg_class where oid = 'mayara.leads_rejeitados'::regclass), 'rls rejeitados';
  assert (select relrowsecurity from pg_class where oid = 'mayara.config'::regclass), 'rls config';
end $$;

rollback;
