-- supabase/tests/0031_central_consultas.test.sql
begin;
do $t$
declare r text;
begin
  -- leads de teste: 2 hoje, 1 ha 3 dias, 1 ha 40 dias
  insert into crm_sync.leads (id, name, status, campaign, created_at, modified_at) values
    ('t-q1', 'Hoje Um', 'New', '[MF] GESTÃO DE PASSIVO', now(), now()),
    ('t-q2', 'Hoje Dois', 'New', '[MF] GESTÃO DE PASSIVO', now(), now()),
    ('t-q3', 'Tres Dias', 'Assigned', null, now() - interval '3 days', now()),
    ('t-q4', 'Quarenta Dias', 'Dead', null, now() - interval '40 days', now());

  r := mayara.contagem_leads('hoje');
  assert r like '%hoje%' and r ~ '(^|[^0-9])[0-9]+ lead', 'texto de hoje: ' || r;
  assert (mayara._numero_na_frase(r)) >= 2, 'conta pelo menos os 2 de hoje: ' || r;
  assert (mayara._numero_na_frase(mayara.contagem_leads('semana'))) >= 3, 'semana inclui o de 3 dias';
  assert (mayara._numero_na_frase(mayara.contagem_leads('mes'))) >= 3, 'mes inclui os recentes';
  assert (mayara._numero_na_frase(mayara.contagem_leads('mes'))) < (select count(*) from crm_sync.leads), 'mes exclui o de 40 dias';
  assert mayara.contagem_leads('ontem-do-ano-passado') ilike '%não reconheci o período%', 'periodo invalido';

  -- situacao de um lead autorizado, com sessao
  insert into mayara.leads_autorizados (telefone, nome, status, espocrm_lead_id) values ('+5511999990801', 'Lead Situacao', 'ativo', 't-q3');
  insert into mayara.session_state (session_key, phone, estado, last_lead_message_at) values ('whatsapp:escritorio:+5511999990801', '+5511999990801', 'S2_QUALIFICACAO', now() - interval '2 hours');
  r := mayara.situacao_lead('+5511999990801');
  assert r like '%Lead Situacao%' and r like '%ativo%' and r like '%S2_QUALIFICACAO%', 'situacao completa: ' || r;
  assert r not like '%5511999990801%', 'nao devolve o telefone completo: ' || r;
  assert r like '%0801%', 'mostra so o final do telefone: ' || r;

  -- lead desconhecido e telefone invalido
  r := mayara.situacao_lead('+5511999990899');
  assert r like '%não está na lista%', 'desconhecido: ' || r;
  r := mayara.situacao_lead('123');
  assert r like '%inválido%', 'invalido: ' || r;

  assert not has_function_privilege('anon', 'mayara.contagem_leads(text)', 'execute'), 'anon sem execute (contagem)';
  assert not has_function_privilege('authenticated', 'mayara.situacao_lead(text)', 'execute'), 'authenticated sem execute (situacao)';
end $t$;
rollback;
select 'OK 0031' as resultado;
